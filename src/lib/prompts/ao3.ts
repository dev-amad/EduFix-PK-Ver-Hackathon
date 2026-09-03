/**
 * AO3 (6-mark part d) evaluative-prompt handling — shared by the Guided
 * Answering Assistant and the Answer Checker.
 *
 * THE BUG THIS FIXES: Pakistan Studies 2059/02 Geography part (d) questions are
 * open-ended, decision-making / evaluative prompts ("To what extent…", "Which …
 * is better…", "Should Pakistan…"). The retrieved chunks supply FACTS, but never
 * a ready-made two-sided argument or a mark scheme for that exact question, so
 * the strict zero-hallucination guardrails (see guardrails.ts) made the model
 * emit the "not covered in the official CAIE syllabus" refusal instead of doing
 * the evaluation. But an evaluative JUDGEMENT is a required AO3 exam SKILL — it
 * is reasoning OVER grounded facts, not an invented fact — so refusing it is
 * wrong.
 *
 * THE FIX: when a question is detected as AO3 evaluative, the system prompts
 * inject AO3_EVALUATION_PERMISSION, which (a) forbids the refusal, (b) requires a
 * balanced Side A (3 marks) / Side B (2 marks) / Final Evaluation (1 mark)
 * structure built FROM the grounded facts, and (c) keeps strict grounding on
 * every fact (evaluation is never a licence to fabricate). AO1/AO2 factual
 * recall/explanation questions are untouched — this fires ONLY on evaluative
 * phrasing (Fix #2), so the "working perfectly" subjects and factual prompts are
 * unaffected.
 *
 * rules.md §1 is preserved: no CAIE content is authored here. This module only
 * detects the question TYPE and states HOW to reason over retrieved chunks.
 */

/**
 * Fix #3 — response-token ceiling for an AO3 evaluative generation. AO3 output
 * is a compact Side A -> Side B -> Concluding Evaluation structure, so it needs
 * a tighter cap than an open-ended generation. Passed as groqChat `maxTokens`
 * ONLY when the question is detected as AO3; non-AO3 requests keep the SDK
 * default (undefined), so their behaviour is unchanged.
 */
export const AO3_MAX_TOKENS = 2_000;

/**
 * Deterministic AO3 detectors — the evaluative/decision command words and the
 * 6-mark signal from the user's Fix #2 spec ("part (d)", "to what extent",
 * "evaluate", "which strategy", "6-mark"), plus close CAIE synonyms. Matched
 * case-insensitively against the raw question text.
 *
 * Bare "should" is deliberately NOT a trigger on its own: "…should…" also appears
 * in 4-mark explanation questions, and every genuine part (d) is already caught
 * by "to what extent", the which…better frame, or the explicit 6-mark signal.
 */
const AO3_EVALUATIVE_PATTERNS: RegExp[] = [
  /\bpart\s*\(\s*d\s*\)/i, // part (d)
  /\bto\s+what\s+extent\b/i,
  /\bhow\s+far\b/i,
  /\bevaluat(?:e|es|ed|ion|ive)\b/i,
  /\bassess(?:ed|es|ment)?\b/i,
  /\bjustif(?:y|ies|ied|ication)\b/i,
  /\brecommend(?:s|ed|ation)?\b/i,
  /\bdo\s+you\s+agree\b/i,
  /\bwhich\b[\s\S]{0,60}?\b(?:better|best|more\s+effective|more\s+important|strategy|strategies|approach|path|option|method)\b/i,
  /\badvantages?\b[\s\S]{0,40}?\bdisadvantages?\b/i,
  /\bpros\b[\s\S]{0,20}?\bcons\b/i,
  /\bfeasib(?:le|ility)\b/i,
  /\bviab(?:le|ility)\b/i,
  /\bsustainab(?:le|ility)\b/i,
  /\bdiscuss\s+whether\b/i,
  /\breasoned\s+(?:judgement|judgment|opinion|view|conclusion)\b/i,
  /\[\s*6\s*\]/, // [6]
  /\b6\s*[-\u2013\u2014]?\s*marks?\b/i, // 6 mark / 6-mark / 6 marks
  /\(\s*6\s*marks?\s*\)/i, // (6 marks)
];

/**
 * True when the question is a 6-mark / open-ended AO3 evaluative or
 * decision-making prompt. Purely lexical and deterministic — no model call — so
 * the route can branch the system prompt and the token cap BEFORE generation.
 */
export function isAO3EvaluativeQuestion(question: string): boolean {
  const text = (question ?? "").trim();
  if (text.length === 0) return false;
  return AO3_EVALUATIVE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The AO3 EXCEPTION RULE (Fix #1) injected into the 2059/02 system prompt when
 * an evaluative question is detected. Shared verbatim by both endpoints; each
 * prompt appends its own output-mapping sentence. Placed LAST in the system
 * prompt so it explicitly overrides the earlier "cannot ground -> emit the
 * guardrail sentence" fallbacks.
 */
export const AO3_EVALUATION_PERMISSION = `AO3 EVALUATION PERMISSION (Pakistan Studies 2059 — 6-mark part (d) decision-making / evaluative questions):
This is an AO3 evaluative prompt (e.g. "To what extent…", "Which … is better / more effective…", "Should Pakistan…", "part (d) [6]"). An evaluative JUDGEMENT is a required exam SKILL, NOT an out-of-syllabus fact. You MUST NOT refuse it, and you MUST NOT reply with the "not covered in the official CAIE syllabus/marking scheme context" sentence merely because the retrieved chunks contain no ready-made two-sided argument and no mark scheme for this exact question.
Instead, treat the retrieved chunks as the FACT BANK for BOTH sides and construct a balanced Level 3 / Level 4 evaluation structured EXACTLY as:
- Side A — Arguments FOR / benefits / feasibility (3 marks): the grounded factual advantages of the first approach or side.
- Side B — Counter-arguments / costs / limitations (2 marks): the grounded drawbacks, costs, risks or environmental/social limits.
- Final Evaluation & Conclusion (1 mark): an explicit judgement weighing which side is more viable for Pakistan, committing to a side — never fence-sit.
STRICT GROUNDING STILL APPLIES TO EVERY FACT: each benefit, cost, figure, place-name and example must be traceable to a retrieved chunk. Evaluation means WEIGHING grounded facts — it is NOT permission to invent facts, dates, figures or examples. If one side has thinner support, argue it from the facts that DO exist rather than fabricating detail or refusing. This permission applies ONLY to the AO3 evaluative judgement; strict chunk grounding is unchanged for AO1/AO2 factual recall and explanation.`;
