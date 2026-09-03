/**
 * Module 3 — CAIE Strict Answer Checker wire contracts.
 *
 * Shared by the grading route (`/api/[subject]/answer-checker`), the OCR route
 * (`/api/ocr`) and the client UI so the evaluation-report shape is defined once
 * (PRD §4.3 + System Prompt §7.2). Unlike Module 2, Module 3 intentionally
 * returns a full composed exemplar answer — the "no prose" rule does NOT apply
 * here; the checker grades and then models a full-mark response.
 */

/** A retrieved source cited in the grading rationale (mirrors Module 2 citations). */
export interface CheckerCitation {
  id: string;
  title: string;
  category: string | null;
  paperCode: string | null;
  year: number | null;
  session: string | null;
  similarity: number;
}

/** The structured evaluation report returned by the grading route (PRD §4.3). */
export interface GradePayload {
  subject: string;
  subjectName: string;
  question: string;
  studentAnswer: string;
  /** Mark awarded by the examiner model, clamped to 0..totalMark. */
  assignedMark: number;
  /** Total marks available for the question. */
  totalMark: number;
  /** CAIE level descriptor, e.g. "Level 3 (5-7 Marks)". */
  assignedLevel: string;
  /** Green callout: correctly cited facts, command-word adherence, valid arguments. */
  strengths: string[];
  /** Tier 1 (AO1 Knowledge): precise missing facts — dates, names, treaties, figures, Quranic/Hadith references. */
  missingElements: string[];
  /** Tier 2 (AO2 Analysis): fully-written Level 3 → Level 4 analytical sentences the student must add. */
  requiredEvaluation: string[];
  /** Plain-English, encouraging explanation of where marks were lost and how to fix them. */
  explanation: string;
  /** Tier 3: a fully-written, exam-ready model paragraph weaving in the AO1 facts + AO2 analysis (PRD §4.3.4). */
  exemplar: string;
  citations: CheckerCitation[];
  insufficientContext: boolean;
  notice: string | null;
  generatedAt: string;
}

export type CheckerErrorCode =
  | "INVALID_SUBJECT"
  | "INVALID_BODY"
  | "RETRIEVAL_FAILED"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED";

export type CheckerApiResponse =
  | { ok: true; data: GradePayload }
  | { ok: false; error: { code: CheckerErrorCode; message: string } };

/** OCR (Task 6.2) wire contract — the OCR route is not subject-scoped. */
export type OcrErrorCode =
  | "INVALID_BODY"
  | "UNSUPPORTED_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED";

export type OcrApiResponse =
  | { ok: true; data: { text: string } }
  | { ok: false; error: { code: OcrErrorCode; message: string } };
