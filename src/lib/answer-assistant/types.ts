/**
 * Shared API contract for the Guided Answering Assistant (Module 2 / Phase 5).
 *
 * These types are the byte-exact wire contract between the API route
 * (`POST /api/[subject]/answer-assistant`) and the frontend that consumes it.
 * The module is strictly scaffolding-only: every field is a concise bullet or a
 * short outline pointer, never a drafted paragraph (PRD §4.3 Module 2).
 */

/** A single scaffold bullet plus the CAIE terminology/references it hinges on. */
export interface ScaffoldBullet {
  text: string;
  terms: string[];
}

/**
 * One recommended paragraph in the answer plan. `focus` is a SHORT pointer
 * (e.g. "Factor A — cause and effect"), never a composed paragraph.
 */
export interface OutlineStep {
  label: string;
  focus: string;
}

/** A retrieved knowledge-base source, surfaced for transparency. */
export interface AssistantCitation {
  id: string;
  title: string;
  category: string | null;
  paperCode: string | null;
  year: number | null;
  session: string | null;
  similarity: number;
}

export interface AnswerScaffoldPayload {
  subject: string;
  subjectName: string;
  question: string;
  /** Detected CAIE command word, e.g. "Explain", "To what extent". */
  commandWord: string | null;
  /** Target mark allocation inferred from the question, when stated. */
  markAllocation: number | null;
  /** Concise bullets describing the required answer structure. */
  structure: string[];
  /** 3–5 core facts/arguments extracted from the marking scheme context. */
  keyPoints: ScaffoldBullet[];
  /** Mandatory dates, quotes, Quranic/Hadith references or terminology. */
  requiredReferences: ScaffoldBullet[];
  /** Recommended paragraph outline (labels + short foci only). */
  paragraphOutline: OutlineStep[];
  citations: AssistantCitation[];
  insufficientContext: boolean;
  notice: string | null;
  /** Set when prose was detected and auto-corrected to bullet-only. */
  guardrail: string | null;
  generatedAt: string;
}

export interface AssistantRequestBody {
  question: string;
}

export type AssistantErrorCode =
  | "INVALID_SUBJECT"
  | "INVALID_BODY"
  | "RETRIEVAL_FAILED"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED";

export type AssistantApiResponse =
  | { ok: true; data: AnswerScaffoldPayload }
  | { ok: false; error: { code: AssistantErrorCode; message: string } };
