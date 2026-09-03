/**
 * Zero-hallucination guardrails — the shared safety block prepended to every
 * generation prompt across all EduFix PK modules (Notes, Answering Assistant,
 * Answer Checker). Encodes the non-negotiable rules from the PRD and rules.md:
 * answer only from retrieved CAIE context, never leak across subjects, and
 * emit the exact "not covered" sentence when a required detail is absent.
 */

import { getSubject, type SubjectId } from "@/lib/subjects";

/**
 * The exact sentence the model (and API) must emit when a required detail is
 * missing from the retrieved context. Reused verbatim by the route's
 * no-context path so the wording never drifts.
 */
export const INSUFFICIENT_CONTEXT_SENTENCE =
  "This specific detail is not covered in the official CAIE syllabus/marking scheme context.";

/**
 * Urdu (3248) counterpart of INSUFFICIENT_CONTEXT_SENTENCE, kept in Urdu script
 * so the guardrail "not covered" path stays zero-English for the urdu subject
 * (the English sentinel would otherwise leak into Urdu output).
 */
export const URDU_INSUFFICIENT_CONTEXT_SENTENCE =
  "یہ تفصیل سرکاری نصاب یا مارکنگ اسکیم کے فراہم کردہ سیاق میں موجود نہیں ہے۔";

/**
 * Returns the subject-appropriate "not covered" sentinel: Urdu script for the
 * urdu subject, English for Islamiyat / Pakistan Studies.
 */
export function insufficientContextSentence(subject: SubjectId): string {
  return subject === "urdu"
    ? URDU_INSUFFICIENT_CONTEXT_SENTENCE
    : INSUFFICIENT_CONTEXT_SENTENCE;
}

/**
 * Refactor (Req #3 + #4) — Urdu (3248) output contract, appended to the Answer
 * Checker and Answering Assistant system prompts for the urdu subject ONLY
 * (Islamiyat / Pakistan Studies prompts are untouched). It enforces authentic
 * Urdu output and minimises token overhead, and is deliberately placed LAST in
 * those prompts so it overrides any English-output or verbosity instruction
 * above it. The JSON keys stay English (structural); only the values are Urdu.
 */
export const URDU_OUTPUT_RULES = `URDU OUTPUT CONTRACT (3248 — highest priority; overrides any English-output or length instruction above):
- LANGUAGE: Generate ALL output exclusively in authentic Urdu (Nastaliq script). Output zero English and zero Roman Urdu. Every human-readable value you return MUST be Urdu script — the JSON keys stay exactly as specified (they are structural), but no value may contain English words or Romanised Urdu. Keep any Qur'anic/Arabic or technical terms in their native script.
- INSUFFICIENT CONTEXT: when a required detail is absent from the retrieved context, emit EXACTLY this Urdu sentence for that point and nothing more (NEVER the English sentinel stated anywhere above): "${URDU_INSUFFICIENT_CONTEXT_SENTENCE}"
- BREVITY: Be ultra-concise and information-dense. No preamble, no meta-commentary, no restating the question or these instructions, no closing remarks. List fields are tight bullets; any model paragraph stays focused, never padded.`;

/** Shared, subject-agnostic guardrail block embedded in every system prompt. */
export const ZERO_HALLUCINATION_GUARDRAILS = `NON-NEGOTIABLE GUARDRAILS (violating any of these is a critical failure):
- Answer EXCLUSIVELY from the supplied retrieved CAIE context below. You must NOT use any outside, prior, or parametric knowledge.
- NEVER invent or guess dates, verse numbers, hadith references, names, statistics, mark allocations, or quotations. Reproduce such details only when they appear verbatim in the supplied context.
- If a required detail is absent from the supplied context, write EXACTLY this sentence and nothing more for that point: "${INSUFFICIENT_CONTEXT_SENTENCE}"
- NEVER reference, compare to, or borrow content from any subject other than the active one. Cross-subject content leakage is forbidden.
- Every factual bullet MUST be traceable to a supplied context chunk. If you cannot ground a claim in the context, omit it.
- Fabrication is strictly forbidden and is always worse than omission.
- Output MUST obey the requested machine-readable schema EXACTLY, with no prose, preamble, explanation, or markdown outside that schema.`;

/**
 * Appends subject-scoping text so the guardrails name the single subject the
 * request is locked to. Falls back to the raw id if the subject is unknown
 * (callers should validate with isSubjectId first).
 */
export function withSubjectScope(subject: SubjectId): string {
  const meta = getSubject(subject);
  const label = meta ? `${meta.name} (CAIE code ${meta.code})` : subject;
  return `${ZERO_HALLUCINATION_GUARDRAILS}

ACTIVE SUBJECT LOCK: This request is scoped strictly to ${label}. Treat any content, terminology, or examples that belong to another subject as out of scope and ignore it entirely.`;
}

/**
 * Markdown-output variant of the zero-hallucination guardrails, used by the
 * Notes module (which now returns long-form Markdown instead of a JSON schema).
 * Identical safety rules, but the final clause demands clean Markdown that
 * follows the required section structure rather than a machine-readable schema.
 */
export const ZERO_HALLUCINATION_GUARDRAILS_MARKDOWN = `NON-NEGOTIABLE GUARDRAILS (violating any of these is a critical failure):
- Answer EXCLUSIVELY from the supplied retrieved CAIE context. You must NOT use any outside, prior, or parametric knowledge.
- NEVER invent or guess dates, verse numbers, hadith references, names, statistics, mark allocations, or quotations. Reproduce such details only when they appear verbatim in the supplied context.
- If a required detail is absent from the supplied context, write EXACTLY this sentence for that point and nothing more: "${INSUFFICIENT_CONTEXT_SENTENCE}"
- NEVER reference, compare to, or borrow content from any subject other than the active one. Cross-subject content leakage is forbidden.
- Every factual claim MUST be traceable to a supplied context chunk. If you cannot ground a claim in the context, omit it.
- Fabrication is strictly forbidden and is always worse than omission.
- Output MUST be clean GitHub-flavoured Markdown that follows the required section structure EXACTLY. Do not add any preamble, apology, or commentary before the first heading, and do not wrap the whole response in a code fence.`;

/** Markdown-output counterpart of withSubjectScope (Notes module). */
export function withSubjectScopeMarkdown(subject: SubjectId): string {
  const meta = getSubject(subject);
  const label = meta ? `${meta.name} (CAIE code ${meta.code})` : subject;
  return `${ZERO_HALLUCINATION_GUARDRAILS_MARKDOWN}

ACTIVE SUBJECT LOCK: This request is scoped strictly to ${label}. Treat any content, terminology, or examples that belong to another subject as out of scope and ignore it entirely.`;
}
