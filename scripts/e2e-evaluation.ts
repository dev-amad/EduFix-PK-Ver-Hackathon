/**
 * End-to-end evaluation harness (Task 7.2).
 *
 * Exercises all three modules across all three subjects with representative
 * CAIE O Level past-paper-style prompts and validates the grounded responses.
 *
 * The sample prompts below are TEST INPUTS (student-style queries) — NOT
 * authored CAIE content. Every syllabus fact, mark, level and citation in the
 * responses is produced at runtime from the RAG knowledge base + LLM
 * (rules.md §2: strictly no hardcoded mock CAIE data).
 *
 * The harness runs in two phases:
 *   A. Offline structural checks — subject registry, Urdu RTL/lang config and
 *      the syllabus topic taxonomy. Needs no server or credentials; always runs.
 *   B. Live HTTP E2E — POSTs each sample to a running dev server and asserts the
 *      response contract + grounding. Requires valid .env.local credentials, a
 *      populated kb_chunks table, and `npm run dev` listening on BASE_URL.
 *
 * Usage:
 *   npm run dev                       # terminal 1 (with a valid .env.local)
 *   tsx scripts/e2e-evaluation.ts     # terminal 2
 *
 * Exit codes: 0 = all pass · 1 = a live check failed · 2 = live E2E skipped
 * (no credentials) · 3 = server unreachable.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./lib/load-env";
import {
  SUBJECTS,
  getSubjectDir,
  getSubjectLang,
  type SubjectId,
} from "../src/lib/subjects";
import { getTopicOptions } from "../src/lib/kb/topics";
import { getEffectiveTaxonomy } from "../src/lib/kb/subtopics";

loadEnvFile();

const BASE_URL = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

// ---------------------------------------------------------------------------
// Sample evaluation inputs — student-style past-paper prompts per subject.
// ---------------------------------------------------------------------------

interface SampleSet {
  subject: SubjectId;
  /** Module 2 (Guided Answering Assistant) — scaffolding for this question. */
  assistantQuestion: string;
  /** Module 3 (Answer Checker) — grade `checkerAnswer` against this question. */
  checkerQuestion: string;
  checkerAnswer: string;
  checkerTotalMark?: number;
}

const SAMPLES: SampleSet[] = [
  {
    subject: "pak-studies",
    assistantQuestion:
      "Explain why the War of Independence of 1857 failed to achieve its main objectives. [14]",
    checkerQuestion:
      "Describe the importance of the Khilafat Movement (1919-1924) to the Pakistan Movement. [7]",
    checkerAnswer:
      "The Khilafat Movement was important because Muslims wanted to protect the Ottoman Caliphate, which they saw as a symbol of Muslim unity. Leaders such as Maulana Muhammad Ali Johar and Shaukat Ali mobilised Muslims across India between 1919 and 1924. It briefly united Hindus and Muslims against the British. Although it failed after Turkey abolished the Caliphate, it awakened Muslim political consciousness and taught mass mobilisation, which later helped the Pakistan Movement.",
    checkerTotalMark: 7,
  },
  {
    subject: "islamiyat",
    assistantQuestion:
      "Describe the significance of the five daily prayers (Salat) in the life of a Muslim. [10]",
    checkerQuestion:
      "What were the main reasons for the Hijrah (migration) from Makkah to Madinah in 622 CE? [10]",
    checkerAnswer:
      "The Hijrah happened because Muslims faced severe persecution in Makkah from the Quraysh. They were tortured and economically boycotted, so it became unsafe to practise Islam openly. The people of Madinah (the Ansar) invited the Prophet (PBUH) and pledged their support at Aqabah. Madinah offered a safe base where the Muslim community could establish an Islamic state. The Hijrah also marks the beginning of the Islamic calendar.",
    checkerTotalMark: 10,
  },
  {
    subject: "urdu",
    assistantQuestion: "اردو زبان میں محاوروں کے استعمال کی اہمیت بیان کریں۔",
    checkerQuestion: "اپنے پسندیدہ کھیل کے بارے میں ایک مختصر مضمون لکھیں۔",
    checkerAnswer:
      "میرا پسندیدہ کھیل کرکٹ ہے۔ یہ پاکستان کا قومی کھیل ہے۔ کرکٹ کھیلنے سے صحت اچھی رہتی ہے اور ٹیم ورک کا جذبہ پیدا ہوتا ہے۔ میں اپنے دوستوں کے ساتھ شام کو کرکٹ کھیلتا ہوں۔ کرکٹ سے مجھے نظم و ضبط اور قیادت سیکھنے کا موقع ملتا ہے۔",
    checkerTotalMark: 15,
  },
];

// ---------------------------------------------------------------------------
// Tiny assertion + reporting helpers.
// ---------------------------------------------------------------------------

type Result = "PASS" | "FAIL" | "SKIP" | "WARN";

interface Row {
  subject: string;
  module: string;
  result: Result;
  detail: string;
}

const rows: Row[] = [];

function record(
  subject: string,
  module: string,
  result: Result,
  detail: string
): void {
  rows.push({ subject, module, result, detail });
  const icon =
    result === "PASS" ? "✓" : result === "FAIL" ? "✗" : result === "SKIP" ? "○" : "!";
  console.log(`  ${icon} [${subject}/${module}] ${result} — ${detail}`);
}

/** Collect assertion failures; returns a human-readable summary ("" = all ok). */
function assertions(checks: Array<[boolean, string]>): string {
  const failed = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  return failed.join("; ");
}

// ---------------------------------------------------------------------------
// Phase A — offline structural checks (no server / credentials required).
// ---------------------------------------------------------------------------

function runOfflineChecks(): boolean {
  console.log("\nPhase A — offline structural checks");
  console.log("─".repeat(52));

  let ok = true;

  // A1. Subject registry + Urdu RTL/lang configuration (Task 7.1).
  const expectedDir: Record<string, "ltr" | "rtl"> = {
    "pak-studies": "ltr",
    islamiyat: "ltr",
    urdu: "rtl",
  };
  const expectedLang: Record<string, string> = {
    "pak-studies": "en",
    islamiyat: "en",
    urdu: "ur",
  };
  for (const subject of SUBJECTS) {
    const dir = getSubjectDir(subject.id);
    const lang = getSubjectLang(subject.id);
    const msg = assertions([
      [dir === expectedDir[subject.id], `dir "${dir}" ≠ "${expectedDir[subject.id]}"`],
      [lang === expectedLang[subject.id], `lang "${lang}" ≠ "${expectedLang[subject.id]}"`],
    ]);
    if (msg) ok = false;
    record(
      subject.id,
      "config",
      msg ? "FAIL" : "PASS",
      msg || `dir=${dir}, lang=${lang}, code=${subject.code}`
    );
  }

  // A2. Topic taxonomy availability (drives the Notes module selector).
  for (const subject of SUBJECTS) {
    const taxonomy = getEffectiveTaxonomy(subject.id as SubjectId);
    const topicCount = taxonomy
      ? getTopicOptions(taxonomy, "all").length
      : 0;
    const msg = assertions([
      [Boolean(taxonomy), "taxonomy missing"],
      [topicCount > 0, "no topics available"],
    ]);
    if (msg) ok = false;
    record(
      subject.id,
      "taxonomy",
      msg ? "FAIL" : "PASS",
      msg || `${topicCount} topics across ${taxonomy?.papers.length ?? 0} papers`
    );
  }

  return ok;
}

// ---------------------------------------------------------------------------
// Phase B — live HTTP end-to-end checks (server + credentials required).
// ---------------------------------------------------------------------------

interface ApiEnvelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

async function postJson(
  url: string,
  body: unknown
): Promise<{ status: number; json: ApiEnvelope }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({
    ok: false,
    error: { code: "BAD_JSON", message: "Response was not valid JSON." },
  }))) as ApiEnvelope;
  return { status: res.status, json };
}

/** Shared grounding + subject-isolation assertions for every module payload. */
function commonChecks(
  data: Record<string, unknown>,
  subject: SubjectId
): Array<[boolean, string]> {
  const meta = SUBJECTS.find((s) => s.id === subject);
  const citations = data.citations;
  const insufficient = data.insufficientContext === true;
  return [
    [data.subject === subject, `subject field "${String(data.subject)}" ≠ "${subject}"`],
    [data.subjectName === meta?.name, `subjectName "${String(data.subjectName)}" unexpected`],
    [Array.isArray(citations), "citations is not an array"],
    [
      insufficient || (Array.isArray(citations) && citations.length > 0),
      "no citations and insufficientContext is false (ungrounded)",
    ],
  ];
}

async function runNotes(subject: SubjectId): Promise<void> {
  const taxonomy = getEffectiveTaxonomy(subject);
  const paper = taxonomy?.papers[0];
  const topic = paper?.topics[0];
  if (!paper || !topic) {
    record(subject, "notes", "SKIP", "no sub-topic available to request");
    return;
  }
  const { status, json } = await postJson(`${BASE_URL}/api/${subject}/notes`, {
    paperCode: paper.id,
    topicId: topic.id,
    topicLabel: topic.title,
  });
  if (status !== 200 || !json.ok || !json.data) {
    record(subject, "notes", "FAIL", `HTTP ${status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim());
    return;
  }
  const data = json.data;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const insufficient = data.insufficientContext === true;
  // Markdown contract: a real note document has section headings and depth.
  const hasHeading = /^#{1,3}\s+\S/m.test(markdown);
  const msg = assertions([
    ...commonChecks(data, subject),
    [typeof data.markdown === "string", "markdown is not a string"],
    [
      insufficient || markdown.trim().length >= 400,
      `markdown too short (${markdown.trim().length} chars)`,
    ],
    [insufficient || hasHeading, "markdown has no section heading"],
  ]);
  record(
    subject,
    "notes",
    msg ? "FAIL" : insufficient ? "WARN" : "PASS",
    msg ||
      (insufficient
        ? "insufficientContext guardrail engaged (correct refusal)"
        : `${markdown.trim().length} chars markdown, sub-topic "${topic.title}"`)
  );
}

async function runAssistant(sample: SampleSet): Promise<void> {
  const { subject } = sample;
  const { status, json } = await postJson(
    `${BASE_URL}/api/${subject}/answer-assistant`,
    { question: sample.assistantQuestion }
  );
  if (status !== 200 || !json.ok || !json.data) {
    record(subject, "answer-assistant", "FAIL", `HTTP ${status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim());
    return;
  }
  const data = json.data;
  const keyPoints = data.keyPoints as Array<{ text: string }> | undefined;
  const insufficient = data.insufficientContext === true;
  // Bullet-only invariant (PRD §4.3): scaffold points must stay concise, never essays.
  const longest = Array.isArray(keyPoints)
    ? keyPoints.reduce((max, kp) => Math.max(max, (kp.text ?? "").length), 0)
    : 0;
  const msg = assertions([
    ...commonChecks(data, subject),
    [Array.isArray(data.structure), "structure is not an array"],
    [Array.isArray(keyPoints), "keyPoints is not an array"],
    [Array.isArray(data.paragraphOutline), "paragraphOutline is not an array"],
    [insufficient || longest <= 320, `a scaffold bullet is ${longest} chars (prose leak)`],
  ]);
  const emptyScaffold = !insufficient && (keyPoints?.length ?? 0) === 0;
  record(
    subject,
    "answer-assistant",
    msg ? "FAIL" : insufficient || emptyScaffold ? "WARN" : "PASS",
    msg ||
      (insufficient
        ? "insufficientContext guardrail engaged (correct refusal)"
        : emptyScaffold
          ? "context retrieved but 0 key points (thin retrieval — see threshold calibration)"
          : `${(keyPoints ?? []).length} key points, longest ${longest} chars`)
  );
}

async function runChecker(sample: SampleSet): Promise<void> {
  const { subject } = sample;
  const body: Record<string, unknown> = {
    question: sample.checkerQuestion,
    answer: sample.checkerAnswer,
  };
  if (sample.checkerTotalMark !== undefined) body.totalMark = sample.checkerTotalMark;

  const { status, json } = await postJson(
    `${BASE_URL}/api/${subject}/answer-checker`,
    body
  );
  if (status !== 200 || !json.ok || !json.data) {
    record(subject, "answer-checker", "FAIL", `HTTP ${status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim());
    return;
  }
  const data = json.data;
  const assigned = Number(data.assignedMark);
  const total = Number(data.totalMark);
  const insufficient = data.insufficientContext === true;
  const msg = assertions([
    ...commonChecks(data, subject),
    [Number.isFinite(assigned), "assignedMark is not a number"],
    [Number.isFinite(total), "totalMark is not a number"],
    [assigned >= 0 && assigned <= total, `assignedMark ${assigned} not within 0..${total}`],
    [total >= 0 && total <= 100, `totalMark ${total} outside 0..100`],
    [typeof data.assignedLevel === "string", "assignedLevel is not a string"],
    [Array.isArray(data.strengths), "strengths is not an array"],
    [Array.isArray(data.missingElements), "missingElements is not an array"],
    // An ungrounded (insufficientContext) check correctly returns no exemplar;
    // only require a full-mark exemplar when context was actually retrieved.
    [insufficient || (typeof data.exemplar === "string" && data.exemplar.length > 0), "exemplar missing despite sufficient context"],
  ]);
  record(
    subject,
    "answer-checker",
    msg ? "FAIL" : insufficient ? "WARN" : "PASS",
    msg || (insufficient ? "insufficientContext guardrail engaged (correct refusal)" : `awarded ${assigned}/${total}, level "${data.assignedLevel}"`)
  );
}

async function serverReachable(): Promise<boolean> {
  try {
    await fetch(BASE_URL, { method: "GET" });
    return true;
  } catch {
    return false;
  }
}

async function runLiveChecks(): Promise<number> {
  console.log("\nPhase B — live HTTP end-to-end checks");
  console.log("─".repeat(52));

  const hasCreds =
    existsSync(path.resolve(process.cwd(), ".env.local")) ||
    Boolean(process.env.GROQ_API_KEY);
  if (!hasCreds) {
    console.log(
      "\n  LIVE E2E SKIPPED — no credentials found.\n" +
        "  To run the live pass:\n" +
        "    1. Copy .env.example -> .env.local and fill in GROQ_API_KEY,\n" +
        "       GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and a Supabase key.\n" +
        "    2. Populate the knowledge base:  npm run db:migrate && npm run db:seed && npm run db:ingest\n" +
        "    3. Start the server:             npm run dev\n" +
        "    4. Re-run this harness:          npm run test:e2e\n"
    );
    return 2;
  }

  if (!(await serverReachable())) {
    console.log(
      `\n  SERVER UNREACHABLE at ${BASE_URL}.\n` +
        "  Start it with `npm run dev` (or set E2E_BASE_URL), then re-run.\n"
    );
    return 3;
  }

  console.log(`  Target server: ${BASE_URL}\n`);
  for (const sample of SAMPLES) {
    await runNotes(sample.subject);
    await runAssistant(sample);
    await runChecker(sample);
  }

  const anyFail = rows.some((r) => r.result === "FAIL");
  return anyFail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Summary + entrypoint.
// ---------------------------------------------------------------------------

function printSummary(): void {
  console.log("\n" + "═".repeat(52));
  console.log("Summary");
  console.log("═".repeat(52));
  const counts = rows.reduce<Record<Result, number>>(
    (acc, r) => ({ ...acc, [r.result]: (acc[r.result] ?? 0) + 1 }),
    { PASS: 0, FAIL: 0, SKIP: 0, WARN: 0 }
  );
  console.log(
    `  PASS ${counts.PASS}   WARN ${counts.WARN}   FAIL ${counts.FAIL}   SKIP ${counts.SKIP}`
  );
  const failures = rows.filter((r) => r.result === "FAIL");
  if (failures.length) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`   - ${f.subject}/${f.module}: ${f.detail}`);
  }
}

async function main(): Promise<void> {
  console.log("EduFix PK — end-to-end evaluation harness (Task 7.2)");
  console.log(`Subjects: ${SAMPLES.map((s) => s.subject).join(", ")}`);

  const offlineOk = runOfflineChecks();
  const liveCode = await runLiveChecks();

  printSummary();

  if (!offlineOk) process.exit(1);
  process.exit(liveCode);
}

main().catch((err) => {
  console.error("\nE2E HARNESS ERROR:", err?.message ?? err);
  process.exit(1);
});
