/**
 * Shared API contract for the Notes module.
 *
 * These types are the byte-exact wire contract between the Notes API route
 * (`POST /api/[subject]/notes`) and the frontend that consumes it. As of the
 * note-generator re-architecture the payload carries long-form MARKDOWN (the
 * CAIE AO1/AO2 study notes) instead of the previous structured section/bullet
 * JSON. Do not rename or restructure — the frontend imports these directly.
 */

export interface NoteCitation {
  id: string;
  title: string;
  category: string | null;
  paperCode: string | null;
  year: number | null;
  session: string | null;
  similarity: number;
}

export interface NotesPayload {
  subject: string;
  subjectName: string;
  paperCode: string;
  /** Paper/section display label resolved server-side, when available. */
  sectionLabel: string | null;
  topicId: string;
  topicLabel: string;
  /**
   * The generated study notes as a GitHub-flavoured Markdown document. Empty
   * string when `insufficientContext` is true (no grounded context retrieved).
   */
  markdown: string;
  citations: NoteCitation[];
  insufficientContext: boolean;
  notice: string | null;
  generatedAt: string;
}

export interface NotesRequestBody {
  paperCode: string;
  topicId: string;
  topicLabel?: string;
}

export type NotesErrorCode =
  | "INVALID_SUBJECT"
  | "INVALID_BODY"
  | "UNKNOWN_TOPIC"
  | "RETRIEVAL_FAILED"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED";

export type NotesApiResponse =
  | { ok: true; data: NotesPayload }
  | { ok: false; error: { code: NotesErrorCode; message: string } };
