/**
 * POST /api/[subject]/answer-checker — CAIE strict grading (Task 6.3).
 *
 * Enforces PRD System Prompt 7.2: an official-examiner persona grades the
 * student's answer strictly from retrieved marking-scheme context and returns a
 * structured evaluation report (mark, level, strengths, missing elements,
 * plain-English feedback and a full-mark exemplar). The subject is derived
 * EXCLUSIVELY from the route param (context isolation, rules.md §2); the body
 * only carries the question, the student's answer and an optional mark hint.
 *
 * Unlike Module 2, a full composed exemplar is intentionally produced here.
 */

import { z } from "zod";

import { isSubjectId, getSubject, type SubjectId } from "@/lib/subjects";
import { searchKnowledgeBase, type VectorSearchResult } from "@/lib/rag/search";
import { groqChat } from "@/lib/ai/groq";
import {
  buildCheckerSystemPrompt,
  buildCheckerUserPrompt,
  insufficientContextSentence,
  isAO3EvaluativeQuestion,
  AO3_MAX_TOKENS,
  type CheckerContextChunk,
} from "@/lib/prompts";
import {
  dedupePreserveCase,
  extractJsonObject,
  isRateLimitError,
  isMaxTokensTruncationError,
} from "@/lib/ai/response";
import type {
  CheckerApiResponse,
  CheckerCitation,
  CheckerErrorCode,
  GradePayload,
} from "@/lib/answer-checker/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retrieval tuning: TOP_K caps the BLENDED result set (criteria + facts). */
const TOP_K = 10;
/** Per-pass depth for the blended retrieval (RAG #3); slightly over-fetched so
 *  enough survives the syllabus/meta-text drop below. */
const CRITERIA_TOP_K = 8;
const FACTUAL_TOP_K = 8;
/** Sanity ceilings so a malformed model reply can never produce absurd marks. */
const MAX_TOTAL_MARK = 100;
const MAX_LIST_ITEMS = 8;
/**
 * Req #4 — Urdu response-token cap. The URDU_OUTPUT_RULES contract forces dense,
 * terse Urdu feedback, so a tighter ceiling than the AO3 2,000 preserves Groq
 * free-tier quota. The truncation-retry net (below) re-runs uncapped if a long
 * exemplar ever overflows it, so the cap can never cause a 502.
 */
const URDU_MAX_TOKENS = 1_500;

/** Request body contract validated with zod v4. */
const bodySchema = z.object({
  question: z.string().trim().min(8).max(2000),
  answer: z.string().trim().min(1).max(8000),
  totalMark: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_TOTAL_MARK)
    .optional()
    .nullable(),
});

/** Loose model-output schema (PRD §7.2, snake_case); clamped after parsing. */
const modelSchema = z.object({
  assigned_mark: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_TOTAL_MARK)
    .optional()
    .nullable(),
  total_mark: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_TOTAL_MARK)
    .optional()
    .nullable(),
  assigned_level: z.string().optional().nullable(),
  strengths: z.array(z.string()).optional().nullable(),
  missing_elements: z.array(z.string()).optional().nullable(),
  required_level4_evaluation: z.array(z.string()).optional().nullable(),
  student_friendly_explanation: z.string().optional().nullable(),
  exemplar_full_mark_answer: z.string().optional().nullable(),
});

type ModelOutput = z.infer<typeof modelSchema>;

const STATUS_BY_CODE: Record<CheckerErrorCode, number> = {
  INVALID_SUBJECT: 400,
  INVALID_BODY: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  RETRIEVAL_FAILED: 502,
};

function jsonError(code: CheckerErrorCode, message: string): Response {
  const body: CheckerApiResponse = { ok: false, error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

function jsonOk(data: GradePayload): Response {
  const body: CheckerApiResponse = { ok: true, data };
  return Response.json(body, { status: 200 });
}

/**
 * RAG #3 — BLENDED retrieval for actionable grading.
 *
 * The old single query was instruction-stuffed ("level descriptors … examiner
 * report … evaluation"); per the notes-route lesson those generic words dominate
 * the embedding and pull GENERIC mark-scheme boilerplate instead of the topic's
 * specific facts — which is exactly why feedback came back as vague "Discuss X"
 * advice. We now run TWO lean, topic-focused passes and interleave them so BOTH
 * reach the model inside the prompt's character budget:
 *   • criteria -> the marking criteria / level descriptors for the question
 *   • factual  -> the deep factual context (dates, names, events, treaties,
 *                 figures, Quranic/Hadith references) needed to expand each point
 * The KB has no literal notes/textbook chunks; its factual depth lives in the
 * marking_scheme / examiner_report / insert / past_paper chunks this surfaces.
 */
function buildCriteriaQuery(subjectName: string, question: string): string {
  return `${subjectName} CAIE O Level. ${question} marking scheme marks awarded level descriptors`;
}

/** Subject-specific FACTUAL retrieval cues (lean, topic-focused — no generic instruction words). */
const FACTUAL_EXPANSIONS: Record<SubjectId, string> = {
  "pak-studies":
    "key dates chronology names events treaties figures causes consequences significance",
  islamiyat:
    "Qur'anic verses Hadith references dates names events teachings significance",
  urdu: "vocabulary idioms \u0645\u062d\u0627\u0648\u0631\u0627\u062a grammar comprehension key terms",
};

function buildFactualQuery(
  subject: SubjectId,
  subjectName: string,
  question: string
): string {
  return `${subjectName} CAIE O Level. ${question} ${FACTUAL_EXPANSIONS[subject]}`;
}

/** Interleave two ranked lists (criteria, factual), dedupe by chunk_id, cap to `total`. */
function blendResults(
  criteria: VectorSearchResult[],
  factual: VectorSearchResult[],
  total: number
): VectorSearchResult[] {
  const seen = new Set<string>();
  const out: VectorSearchResult[] = [];
  const push = (row: VectorSearchResult | undefined): void => {
    if (!row || seen.has(row.chunk_id)) return;
    seen.add(row.chunk_id);
    out.push(row);
  };
  const max = Math.max(criteria.length, factual.length);
  for (let i = 0; i < max && out.length < total; i++) {
    push(criteria[i]);
    push(factual[i]);
  }
  return out;
}

/**
 * Syllabus chunks are meta-text (topic lists + assessment objectives) — never
 * grounding for grading a specific answer, and they crowd marking schemes out of
 * the character budget. Evaluative AO3 phrasing ("to what extent … achieve its
 * aims") retrieves them especially heavily, which starves the model of traceable
 * facts and yields an empty 0-mark grade. Drop them (mirrors the notes route's
 * sub_topic isolation, which likewise keeps syllabus meta-text out of context).
 * Unknown-category rows are KEPT (only a confirmed meta-text category is dropped).
 */
const NON_GROUNDING_CATEGORIES = new Set(["syllabus"]);
function dropMetaText(rowsIn: VectorSearchResult[]): VectorSearchResult[] {
  return rowsIn.filter((row) => {
    const md = (row.metadata ?? {}) as Record<string, unknown>;
    const category =
      row.document_category ??
      (typeof md.category === "string" ? md.category : null);
    return category === null || !NON_GROUNDING_CATEGORIES.has(category);
  });
}

/**
 * Prefer the joined document_* columns, falling back to the chunk metadata
 * JSONB. manual-ingest.ts writes category/session/year/paper_code into the
 * chunk metadata (not always the kb_documents columns), so without this
 * fallback the checker's citations and prompt source-lines come back empty
 * ("Untitled source"). Mirrors the notes route's readMeta.
 */
function readMeta(row: VectorSearchResult) {
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const yearRaw = row.document_year ?? md.year;
  const yearNum =
    typeof yearRaw === "number"
      ? yearRaw
      : typeof yearRaw === "string" && yearRaw.trim() !== ""
        ? Number(yearRaw)
        : NaN;
  return {
    title:
      row.document_title ?? str(md.filename) ?? str(md.title) ?? "Untitled source",
    category: row.document_category ?? str(md.category),
    paperCode: row.document_paper_code ?? str(md.paper_code),
    year: Number.isFinite(yearNum) ? yearNum : null,
    session: row.document_session ?? str(md.session),
  };
}

/** Map a retrieved chunk into the prompt's context shape with a stable id. */
function toContextChunk(row: VectorSearchResult, index: number): CheckerContextChunk {
  const meta = readMeta(row);
  return {
    id: `c${index + 1}`,
    title: meta.title,
    category: meta.category,
    paperCode: meta.paperCode,
    year: meta.year,
    session: meta.session,
    text: row.content ?? "",
  };
}

/** Build the citation list (c1..cN), tolerating null metadata. */
function toCitations(rows: VectorSearchResult[]): CheckerCitation[] {
  return rows.map((row, index) => {
    const meta = readMeta(row);
    return {
      id: `c${index + 1}`,
      title: meta.title,
      category: meta.category,
      paperCode: meta.paperCode,
      year: meta.year,
      session: meta.session,
      similarity: Math.round((row.similarity ?? 0) * 1000) / 1000,
    };
  });
}

/** Normalise a loose string array into a trimmed, deduped, capped list. */
function cleanList(items: string[] | null | undefined, max: number): string[] {
  if (!Array.isArray(items)) return [];
  const cleaned = items
    .map((item) =>
      typeof item === "string" ? item.replace(/\s+/g, " ").trim() : ""
    )
    .filter((item) => item.length > 0);
  return dedupePreserveCase(cleaned).slice(0, max);
}

/** Call the model once and validate the schema; throws on unusable output. */
async function generateOnce(
  systemPrompt: string,
  userPrompt: string,
  maxTokens?: number
): Promise<ModelOutput> {
  const raw = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, json: true, maxTokens }
  );
  const parsed = extractJsonObject(raw);
  const result = modelSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Model output failed schema validation.");
  }
  return result.data;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ subject: string }> }
): Promise<Response> {
  const { subject: subjectParam } = await ctx.params;

  // 1. Subject comes ONLY from the route — the context-isolation boundary.
  if (!isSubjectId(subjectParam)) {
    return jsonError("INVALID_SUBJECT", "Unknown subject in route.");
  }
  const subject: SubjectId = subjectParam;
  const meta = getSubject(subject);
  const subjectName = meta?.name ?? subject;
  const insufficientSentence = insufficientContextSentence(subject);

  // 2. Parse + validate the body (question, answer and optional mark hint).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError(
      "INVALID_BODY",
      "Provide a question (8–2000 chars) and a non-empty answer."
    );
  }
  const { question, answer } = parsedBody.data;
  const markHint = parsedBody.data.totalMark ?? null;

  // Fix #2/#3 — AO3 (6-mark part d) evaluative detection. A 2059/02 part (d) is
  // always 6 marks, so either evaluative phrasing or a 6-mark hint triggers the
  // AO3 permission (Fix #1) and the 2000-token cap (Fix #3) for pak-studies only.
  const isAO3 =
    subject === "pak-studies" &&
    (isAO3EvaluativeQuestion(question) || markHint === 6);
  // Req #4 — cap response tokens where safe: AO3 (pak-studies) keeps its
  // 2,000-token evaluative budget; Urdu gets a tighter cap because the
  // URDU_OUTPUT_RULES contract demands dense, terse output. Islamiyat and
  // non-AO3 Pakistan Studies stay uncapped (behaviour unchanged).
  const isUrdu = subject === "urdu";
  const capMaxTokens = isAO3
    ? AO3_MAX_TOKENS
    : isUrdu
      ? URDU_MAX_TOKENS
      : undefined;

  // 3. BLENDED retrieval (RAG #3): marking criteria + deep factual context, run
  //    concurrently and interleaved, so the model can write out the SPECIFIC
  //    missing facts instead of generic structural advice. allSettled keeps the
  //    request alive if one pass hiccups; only a total failure is fatal.
  const criteriaQuery = buildCriteriaQuery(subjectName, question);
  const factualQuery = buildFactualQuery(subject, subjectName, question);
  let rows: VectorSearchResult[];
  try {
    const [criteriaRes, factualRes] = await Promise.allSettled([
      searchKnowledgeBase(criteriaQuery, {
        subject_id: subject,
        topK: CRITERIA_TOP_K,
      }),
      searchKnowledgeBase(factualQuery, {
        subject_id: subject,
        topK: FACTUAL_TOP_K,
      }),
    ]);
    if (criteriaRes.status === "rejected" && factualRes.status === "rejected") {
      throw criteriaRes.reason;
    }
    rows = blendResults(
      criteriaRes.status === "fulfilled" ? dropMetaText(criteriaRes.value) : [],
      factualRes.status === "fulfilled" ? dropMetaText(factualRes.value) : [],
      TOP_K
    );
  } catch (err) {
    console.error("[answer-checker] retrieval failed:", err);
    return jsonError("RETRIEVAL_FAILED", "Failed to retrieve marking-scheme context.");
  }

  const basePayload = {
    subject,
    subjectName,
    question,
    studentAnswer: answer,
    citations: toCitations(rows),
    generatedAt: new Date().toISOString(),
  };

  // 4. No grounded context → 200 with the guardrail notice, no LLM call.
  if (rows.length === 0) {
    const payload: GradePayload = {
      ...basePayload,
      assignedMark: 0,
      totalMark: markHint ?? 0,
      assignedLevel: "",
      strengths: [],
      missingElements: [],
      requiredEvaluation: [],
      explanation: insufficientSentence,
      exemplar: "",
      insufficientContext: true,
      notice: insufficientSentence,
    };
    return jsonOk(payload);
  }

  // 5. Generate the evaluation report (System Prompt 7.2).
  const systemPrompt = buildCheckerSystemPrompt(subject, { isAO3 });
  const chunks = rows.map(toContextChunk);
  const userPrompt = buildCheckerUserPrompt({
    subject,
    question,
    answer,
    chunks,
    totalMarkHint: markHint,
  });

  let model: ModelOutput;
  try {
    try {
      model = await generateOnce(systemPrompt, userPrompt, capMaxTokens);
    } catch (err) {
      // A response-token cap (AO3 2,000 or the Urdu cap) can truncate the
      // checker's full-exemplar JSON, which Groq hard-fails as
      // json_validate_failed. Retry ONCE uncapped so a legitimate question is
      // graded instead of returning a 502.
      if (
        !(
          capMaxTokens != null &&
          isMaxTokensTruncationError(err) &&
          !isRateLimitError(err)
        )
      ) {
        throw err;
      }
      console.warn("[answer-checker] reply hit the token cap; retrying uncapped.");
      model = await generateOnce(systemPrompt, userPrompt);
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      console.error("[answer-checker] upstream rate limited:", err);
      return jsonError(
        "RATE_LIMITED",
        "The answer checker is busy right now. Please try again shortly."
      );
    }
    console.error("[answer-checker] generation failed:", err);
    return jsonError("UPSTREAM_ERROR", "Failed to grade the answer from context.");
  }

  // 6. Clamp marks into a consistent 0 <= assigned <= total range.
  const rawTotal = model.total_mark ?? markHint ?? 0;
  const totalMark = Math.min(
    Math.max(Number.isFinite(rawTotal) ? Math.trunc(rawTotal) : 0, 0),
    MAX_TOTAL_MARK
  );
  const rawAssigned = model.assigned_mark ?? 0;
  const assignedMark = Math.min(
    Math.max(Number.isFinite(rawAssigned) ? Math.trunc(rawAssigned) : 0, 0),
    totalMark
  );

  const strengths = cleanList(model.strengths, MAX_LIST_ITEMS);
  const missingElements = cleanList(model.missing_elements, MAX_LIST_ITEMS);
  const requiredEvaluation = cleanList(
    model.required_level4_evaluation,
    MAX_LIST_ITEMS
  );
  const assignedLevel = (model.assigned_level ?? "").trim();
  const explanation = (model.student_friendly_explanation ?? "").trim();
  const exemplar = (model.exemplar_full_mark_answer ?? "").trim();

  const insufficient =
    totalMark === 0 && strengths.length === 0 && missingElements.length === 0;

  const payload: GradePayload = {
    ...basePayload,
    assignedMark,
    totalMark,
    assignedLevel,
    strengths,
    missingElements,
    requiredEvaluation,
    explanation: explanation || (insufficient ? insufficientSentence : ""),
    exemplar,
    insufficientContext: insufficient,
    notice: insufficient ? insufficientSentence : null,
  };

  return jsonOk(payload);
}

export function GET(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Use POST." },
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}
