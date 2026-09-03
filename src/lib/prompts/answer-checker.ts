/**
 * CAIE Strict Answer Checker prompt builders (PRD §7.2).
 *
 * Assembles the system + user prompts for the examiner/grading agent. The
 * system prompt encodes PRD System Prompt 7.2 in intent, layered on the shared
 * zero-hallucination guardrails and a per-subject CAIE level rubric (PRD §5).
 * No CAIE subject matter is authored here — the mark, level, strengths,
 * missing elements and exemplar must all be grounded in retrieved context.
 *
 * NOTE: unlike Module 2, Module 3 legitimately produces a full composed
 * exemplar answer, so no bullet-only limits are applied here.
 */

import { getSubject, type SubjectId } from "@/lib/subjects";
import {
  INSUFFICIENT_CONTEXT_SENTENCE,
  URDU_OUTPUT_RULES,
  withSubjectScope,
} from "@/lib/prompts/guardrails";
import { AO3_EVALUATION_PERMISSION } from "@/lib/prompts/ao3";

/** Defensive context budget so we never overflow the model's window. */
export const MAX_CONTEXT_CHARS = 18_000;
/**
 * Urdu-safe input budget (Req #4 — token minimisation). Urdu tokenises densely
 * (~3 chars/token), so the urdu subject keeps the smaller 8k-char budget proven
 * in the notes route to stay well under Groq's free-tier 8000-TPM cap. Chunks
 * are similarity-ordered, so the budget keeps the most on-topic sources first.
 */
export const MAX_CONTEXT_CHARS_URDU = 8_000;
/** Per-chunk excerpt cap applied before the global budget. */
export const MAX_CHUNK_CHARS = 2_200;

/** A retrieved context chunk already assigned a stable citation id. */
export interface CheckerContextChunk {
  id: string;
  title: string | null;
  category: string | null;
  paperCode: string | null;
  year: number | null;
  session: string | null;
  text: string;
}

export interface BuildCheckerUserPromptArgs {
  subject: SubjectId;
  question: string;
  answer: string;
  chunks: CheckerContextChunk[];
  /** Optional mark allocation stated by the student, used only as a hint. */
  totalMarkHint?: number | null;
}

/** Per-subject CAIE level/marking rubric, aligned to PRD §5. */
const SUBJECT_RUBRIC: Record<SubjectId, string> = {
  "pak-studies":
    "Pakistan Studies (2059): apply the Paper 1 level descriptors — 3/4-mark questions need 3–4 distinct factual statements; 7-mark questions need one developed point (Level 2) or 2+ points developed with cause and effect (Level 3, 5–7 marks); 14-mark questions need a balanced both-sides argument plus a clear evaluative conclusion (Level 4, 11–14 marks). For Paper 2 (Environment of Pakistan) require geographical terminology and specific named examples (e.g. Tarbela Dam, Warsak Dam, Indus Basin).",
  islamiyat:
    "Islamiyat (2058): grade Part (a) 10-mark answers on factual recall — precise Quranic references, Hadith citations, accurate dates and chronology; grade Part (b) 4-mark answers on evaluation and modern-day application with the student's own reasoned reflection. Keep the Part (a) and Part (b) rubrics strictly distinct, and credit verse/narration references only where the retrieved context supports them.",
  urdu:
    "Urdu — Second Language (3248): for Directed Writing (15 marks) assess format (letter/email/speech), adherence to the ~150-word limit and precise execution of each required bullet point; for Sentence Transformation & Translation assess exact grammatical correctness and contextual vocabulary. Preserve and assess Urdu script and give feedback that respects right-to-left composition.",
};

/**
 * Build the Answer Checker system prompt: official-examiner persona, shared
 * guardrails, PRD §7.2 operational rules, the subject rubric, and the exact
 * JSON output contract.
 */
export function buildCheckerSystemPrompt(
  subject: SubjectId,
  opts?: { isAO3?: boolean }
): string {
  const meta = getSubject(subject);
  const subjectName = meta?.name ?? subject;
  const subjectCode = meta?.code ?? "";
  const subjectUpper = subjectName.toUpperCase();

  // Fix #1/#2 — AO3 (6-mark part d) evaluative permission, Pakistan Studies only
  // and ONLY when the route detected evaluative phrasing (or a 6-mark hint).
  // Appended LAST so it overrides rule 3 and the "cannot ground the grading"
  // fallback: grade the balanced evaluation instead of refusing it.
  const ao3Rule =
    subject === "pak-studies" && opts?.isAO3
      ? `\n\n${AO3_EVALUATION_PERMISSION}
Apply this to GRADING: assess the student's answer against the Side A (3 marks) / Side B (2 marks) / Final Evaluation & Conclusion (1 mark) rubric. This AO3 permission OVERRIDES rule 3 and the "cannot ground the grading" fallback below — do NOT set total_mark to 0 and do NOT put "${INSUFFICIENT_CONTEXT_SENTENCE}" in student_friendly_explanation merely because the exact mark scheme for this evaluative question is absent. Use the 6-mark total (from the question or the student hint), award marks for grounded both-sides reasoning and a committed concluding judgement, and keep every fact in strengths, missing_elements, required_level4_evaluation and exemplar_full_mark_answer traceable to the retrieved chunks.
Keep the reply COMPACT so it completes inside the 2,000-token response budget: write exemplar_full_mark_answer as a CONCISE Side A -> Side B -> Concluding Evaluation sketch (about 120-180 words, NOT a full essay), keep strengths, missing_elements and required_level4_evaluation to 2-3 terse bullets each, and student_friendly_explanation to 2-3 sentences.`
      : "";

  // Refactor (Req #3/#4) — enforce authentic Urdu output + token brevity for the
  // urdu subject only. Appended LAST so it overrides the English-oriented rules
  // above; AO3 never applies to urdu (pak-studies only), so the two never clash.
  const urduRule = subject === "urdu" ? `\n\n${URDU_OUTPUT_RULES}` : "";

  return `YOU ARE AN EXPERT CAIE EXAMINER AND SENIOR TUTOR FOR O LEVEL ${subjectUpper} (${subjectCode}).

YOUR GOAL: Grade the student's submitted answer STRICTLY from the retrieved CAIE Marking Schemes, level descriptors and Examiner Reports — THEN teach the student exactly how to reach full marks. NEVER give generic structural advice such as "Discuss X", "Explain Y", "Add more detail" or "Mention the causes". Instead, WRITE OUT the specific missing facts, historical evidence, key terminology, dates, names, treaties, figures and analytical points the student must add — using ONLY facts present in the retrieved context.

${withSubjectScope(subject)}

STRICT OPERATIONAL RULES (PRD §7.2):
1. Grade strictly from the retrieved marking scheme and level descriptions. Do NOT award benefit of the doubt unless the mark scheme explicitly permits it.
2. Deduct or withhold marks where key arguments lack development, or where required historical / religious / textual evidence is missing or inaccurate.
3. Derive the level and mark band ONLY from the retrieved context. If the context does not contain the marking scheme for this exact question, use the total stated in the question if present, otherwise set total_mark to 0 and explain the limitation in student_friendly_explanation.
4. The exemplar_full_mark_answer MUST be grounded in the retrieved context; never introduce facts, dates, verses or figures that are absent from it.

3-TIER ACTIONABLE FEEDBACK — this is the core of your job; never be vague:
- TIER 1 — MISSING FACTUAL POINTS (AO1 Knowledge) -> field "missing_elements": the PRECISE facts the student omitted or got wrong. Write each one out concretely in the form "Must include: <event/treaty/person>, <exact date or year>, <specific figure/place>, <its consequence>" — name the incident, the month and year, the number involved and what it caused. NEVER a bare instruction like "discuss the incident" or "mention the causes".
- TIER 2 — REQUIRED LEVEL 4 EVALUATION (AO2 Analysis) -> field "required_level4_evaluation": the explicit analytical sentences that bridge Level 3 to Level 4, written in full in the form "<decision/event> caused <effect on a named group / unity / the economy>, which is why <outcome or significance>". Give the causal reasoning itself, never a directive like "explain the impact" or "add evaluation".
- TIER 3 — MODEL ANSWER PARAGRAPH -> field "exemplar_full_mark_answer": a FULLY-FORMED, exam-ready model paragraph (or short set of paragraphs) showing exactly how to weave the Tier 1 facts and the Tier 2 analysis into a full-mark response. Real prose the student can learn from — not an outline, not bullet fragments.
Across all three tiers every fact, date, name, figure and reference MUST be traceable to the retrieved context; if a needed fact is absent from the context, do NOT invent it — state what is missing and continue.

SUBJECT RUBRIC: ${SUBJECT_RUBRIC[subject]}

OUTPUT CONTRACT — return a SINGLE JSON object and NOTHING else, matching exactly:
{
  "assigned_mark": integer,
  "total_mark": integer,
  "assigned_level": string,
  "strengths": string[],
  "missing_elements": string[],
  "required_level4_evaluation": string[],
  "student_friendly_explanation": string,
  "exemplar_full_mark_answer": string
}
- "assigned_mark": integer marks awarded, with 0 <= assigned_mark <= total_mark.
- "total_mark": integer total marks available for this question.
- "assigned_level": the CAIE level descriptor with its mark band, e.g. "Level 3 (5-7 Marks)"; "" if the context defines no levels.
- "strengths": 2–5 concise bullets on what earned marks (correctly cited facts, command-word adherence, valid arguments).
- "missing_elements": TIER 1 (AO1 Knowledge). 2–6 bullets, each a PRECISE fact the student omitted or got wrong — an exact date, name, place, treaty, figure or (Islamiyat) Quranic verse / Hadith reference — written out concretely ("Must include: <event>, <date>, <figure>, <consequence>"), NEVER as an instruction like "discuss…" or "explain…". Grounded in the retrieved context only.
- "required_level4_evaluation": TIER 2 (AO2 Analysis). 1–4 FULLY-WRITTEN analytical sentences that bridge Level 3 → Level 4 (cause→effect, significance, why something failed or mattered). Give the analysis itself, not a directive to analyse. Leave empty only if the answer already reaches the top level or the question is pure AO1 recall.
- "student_friendly_explanation": a short, encouraging, plain-English explanation of why marks were lost and how to bridge the gap to full marks.
- "exemplar_full_mark_answer": TIER 3. A complete, exam-ready model answer in real prose (standard CAIE layout) showing exactly how to weave the Tier 1 facts and Tier 2 analysis into a full-mark response — NOT an outline and NOT bullet fragments. Grounded ONLY in the retrieved context.
- If the context cannot ground the grading, still return valid JSON: set assigned_mark and total_mark to 0, leave strengths, missing_elements and required_level4_evaluation empty, and put EXACTLY "${INSUFFICIENT_CONTEXT_SENTENCE}" in student_friendly_explanation.
- Do NOT wrap the JSON in markdown fences or add any commentary.${ao3Rule}${urduRule}`;
}

/** Truncate a single chunk excerpt to the per-chunk cap. */
function clampExcerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_CHUNK_CHARS
    ? `${trimmed.slice(0, MAX_CHUNK_CHARS)}\u2026`
    : trimmed;
}

/** Render one chunk's non-null metadata as a compact source line. */
function formatChunkMeta(chunk: CheckerContextChunk): string {
  const parts = [
    chunk.title,
    chunk.category,
    chunk.year != null ? String(chunk.year) : null,
    chunk.session,
    chunk.paperCode,
  ].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  return parts.length > 0 ? parts.join(" | ") : "source metadata unavailable";
}

/**
 * Build the Answer Checker user prompt: the numbered retrieved context, then
 * the student's question and submitted answer, matching the PRD §7.2 template
 * order. Applies per-chunk and total-context character budgets defensively.
 */
export function buildCheckerUserPrompt(
  args: BuildCheckerUserPromptArgs
): string {
  const blocks: string[] = [];
  const header = "CONTEXT RETRIEVED FROM KNOWLEDGE BASE:";
  let total = header.length;
  // Req #4 — subject-aware input budget: Urdu keeps the smaller TPM-safe 8k.
  const budget =
    args.subject === "urdu" ? MAX_CONTEXT_CHARS_URDU : MAX_CONTEXT_CHARS;

  for (const chunk of args.chunks) {
    const excerpt = clampExcerpt(chunk.text);
    if (!excerpt) continue;
    const block = `\n\n[${chunk.id}] (${formatChunkMeta(chunk)})\n${excerpt}`;
    if (total + block.length > budget) break;
    blocks.push(block);
    total += block.length;
  }

  const hint =
    typeof args.totalMarkHint === "number" && args.totalMarkHint > 0
      ? `\n\nSTATED TOTAL MARKS FOR THIS QUESTION (student-provided hint): ${args.totalMarkHint}`
      : "";

  return (
    `${header}${blocks.join("")}` +
    `\n\nSTUDENT QUESTION:\n${args.question.trim()}` +
    `${hint}` +
    `\n\nSTUDENT SUBMITTED ANSWER:\n${args.answer.trim()}`
  );
}
