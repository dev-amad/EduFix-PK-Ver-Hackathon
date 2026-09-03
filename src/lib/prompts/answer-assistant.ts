/**
 * Guided Answering Assistant prompt builders (PRD §7.1).
 *
 * Assembles the system + user prompts for the scaffolding-only agent. The
 * system prompt encodes PRD System Prompt 7.1 verbatim in intent, layered on
 * the shared zero-hallucination guardrails and hardened with explicit
 * bullet-only length limits so the model never composes paragraphs. No CAIE
 * subject matter is authored here — everything must come from retrieved
 * context (rules.md §1).
 */

import { getSubject, type SubjectId } from "@/lib/subjects";
import {
  INSUFFICIENT_CONTEXT_SENTENCE,
  URDU_OUTPUT_RULES,
  withSubjectScope,
} from "@/lib/prompts/guardrails";
import { AO3_EVALUATION_PERMISSION } from "@/lib/prompts/ao3";
import {
  MAX_BULLET_CHARS,
  MAX_BULLET_SENTENCES,
  MAX_BULLET_WORDS,
  MAX_OUTLINE_FOCUS_WORDS,
} from "@/lib/answer-assistant/limits";

/** Defensive context budget so we never overflow the model's window. */
export const MAX_CONTEXT_CHARS = 18_000;
/**
 * Urdu-safe input budget (Req #4 — token minimisation). Urdu tokenises densely
 * (~3 chars/token), so the urdu subject keeps the smaller 8k-char budget proven
 * in the notes route to stay well under Groq's free-tier 8000-TPM cap.
 */
export const MAX_CONTEXT_CHARS_URDU = 8_000;
/** Per-chunk excerpt cap applied before the global budget. */
export const MAX_CHUNK_CHARS = 2_200;

/** A retrieved context chunk already assigned a stable citation id. */
export interface AssistantContextChunk {
  id: string;
  title: string | null;
  category: string | null;
  paperCode: string | null;
  year: number | null;
  session: string | null;
  text: string;
}

export interface BuildAssistantUserPromptArgs {
  subject: SubjectId;
  question: string;
  chunks: AssistantContextChunk[];
}

/** Per-subject scaffolding emphasis, aligned to PRD §5. */
const SUBJECT_ADDENDUM: Record<SubjectId, string> = {
  "pak-studies":
    "Pakistan Studies (2059): scaffold cause–effect chains and chronological dates. Reflect the 3/4-mark (distinct factual statements), 7-mark (developed point(s) with cause and effect) and 14-mark (balanced both-sides argument + evaluation) structures for Paper 1; for Paper 2 demand geographical terminology and specific examples.",
  islamiyat:
    "Islamiyat (2058): separate Part (a) 10-mark factual recall (precise Quranic/Hadith references, accurate dates, chronology) from Part (b) 4-mark evaluation and modern-day application. Supply verse or narration attributions ONLY when they appear verbatim in the context.",
  urdu:
    "Urdu — Second Language (3248): emphasise format conventions (letter/email/speech), the ~150-word limit, precise bullet-point execution, and advanced vocabulary/idioms (محاورات). Preserve Urdu script verbatim.",
};

/**
 * Build the Answering Assistant system prompt: scaffolding-only persona,
 * shared guardrails, PRD §7.1 operational rules, hard bullet limits, and the
 * exact JSON output contract.
 */
export function buildAssistantSystemPrompt(
  subject: SubjectId,
  opts?: { isAO3?: boolean }
): string {
  const meta = getSubject(subject);
  const subjectName = meta?.name ?? subject;
  const subjectCode = meta?.code ?? "";
  const subjectUpper = subjectName.toUpperCase();

  // Fix #1/#2 — AO3 (6-mark part d) evaluative permission, Pakistan Studies only
  // and ONLY when the route detected evaluative phrasing in the question.
  // Appended LAST so it overrides the "cannot ground -> guardrail sentence"
  // fallbacks below, and maps Side A/B/Conclusion into the JSON contract.
  const ao3Rule =
    subject === "pak-studies" && opts?.isAO3
      ? `\n\n${AO3_EVALUATION_PERMISSION}
Map this AO3 structure into the JSON contract: put the three parts — "Side A (3 marks): benefits/feasibility", "Side B (2 marks): costs/limitations", "Final evaluation (1 mark): which side is more viable for Pakistan" — as the "structure" bullets IN THAT ORDER; set "paragraphOutline" to Side A -> Side B -> Concluding Evaluation; and put the grounded facts for BOTH sides into "keyPoints". Keep every bullet within the hard length limits and NEVER emit the guardrail sentence for the evaluative judgement.`
      : "";

  // Refactor (Req #3/#4) — enforce authentic Urdu output + token brevity for the
  // urdu subject only. Appended LAST so it overrides the English-framed rules
  // above (and drops the old English-gloss habit); AO3 is pak-studies only.
  const urduRule = subject === "urdu" ? `\n\n${URDU_OUTPUT_RULES}` : "";

  return `YOU ARE THE EDUFIX PK GUIDED ANSWER ASSISTANT FOR CAIE O LEVEL ${subjectUpper} (${subjectCode}).

YOUR GOAL: Help the student STRUCTURE AND PLAN their own answer using only the retrieved CAIE Knowledge Base materials. You scaffold — you never compose the answer for them.

${withSubjectScope(subject)}

STRICT OPERATIONAL RULES (PRD §7.1):
1. DO NOT WRITE COMPLETE PARAGRAPHS OR FULL ESSAYS UNDER ANY CIRCUMSTANCES.
2. DO NOT GIVE AWAY READY-MADE COMPOSITIONS, model answers, or finished prose strung together.
3. OUTPUT MUST BE STRICTLY BULLETED / SHORT-FRAGMENT ONLY:
   - Identify the command word and the target mark allocation.
   - List key points / facts drawn from the marking scheme context.
   - List mandatory dates, quotes, Quranic/Hadith references, or terminology required.
   - Provide a recommended paragraph outline as LABEL + SHORT POINTER only (e.g. "Paragraph 1 -> Factor A").
4. GROUNDING: Use ONLY the provided Knowledge Base context. If a required detail is missing, state EXACTLY: "${INSUFFICIENT_CONTEXT_SENTENCE}" and never invent it.

HARD LENGTH LIMITS (machine-enforced after you reply — violating them forces a regeneration):
- Every bullet MUST be a single telegraphic fragment of at most ${MAX_BULLET_WORDS} words and at most ${MAX_BULLET_SENTENCES} sentences and ${MAX_BULLET_CHARS} characters.
- paragraphOutline "focus" MUST be at most ${MAX_OUTLINE_FOCUS_WORDS} words — a pointer, NOT a drafted paragraph.
- NEVER put line breaks inside a bullet and NEVER chain several sentences into one bullet.

SUBJECT FOCUS: ${SUBJECT_ADDENDUM[subject]}

OUTPUT CONTRACT — return a SINGLE JSON object and NOTHING else, matching exactly:
{
  "commandWord": string,
  "markAllocation": number | null,
  "structure": string[],
  "keyPoints": [{ "text": string, "terms": string[] }],
  "requiredReferences": [{ "text": string, "terms": string[] }],
  "paragraphOutline": [{ "label": string, "focus": string }]
}
- "commandWord": the single CAIE command word (e.g. "Explain", "Describe", "Evaluate", "To what extent"); "" if none is stated.
- "markAllocation": the integer mark target if the question states it, else null.
- "structure": 1–3 concise bullets on how the answer must be built for that command word / mark band.
- "keyPoints": 3–5 fragment bullets of the core facts/arguments grounded in the context.
- "requiredReferences": fragment bullets for dates, quotes, Quranic verses/Hadith, or terminology the marking scheme demands (ONLY those present in the context).
- "terms": the CAIE key terminology appearing in that bullet.
- If the context cannot ground the question, leave the arrays empty and put the guardrail sentence as the single "structure" bullet.
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
function formatChunkMeta(chunk: AssistantContextChunk): string {
  const parts = [
    chunk.title,
    chunk.category,
    chunk.year != null ? String(chunk.year) : null,
    chunk.session,
    chunk.paperCode,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return parts.length > 0 ? parts.join(" | ") : "source metadata unavailable";
}

/**
 * Build the Answering Assistant user prompt: the numbered retrieved context
 * followed by the student's question, matching the PRD §7.1 template order.
 * Applies per-chunk and total-context character budgets defensively.
 */
export function buildAssistantUserPrompt(
  args: BuildAssistantUserPromptArgs
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

  return `${header}${blocks.join("")}\n\nSTUDENT QUESTION:\n${args.question.trim()}`;
}
