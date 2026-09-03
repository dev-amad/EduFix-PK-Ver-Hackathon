/**
 * POST /api/ocr — Vision OCR for handwritten answer scripts (Task 6.2).
 *
 * Accepts a base64-encoded image (or PDF) uploaded from the Answer Checker and
 * returns the transcribed text via Gemini vision so the student can verify it
 * before grading. This route is intentionally NOT subject-scoped: OCR never
 * touches the knowledge base, so there is no cross-subject context to isolate.
 * The extracted text is returned to the client for editing — it is never graded
 * until the student confirms it and posts to /api/[subject]/answer-checker.
 */

import { z } from "zod";

import { extractTextFromImage } from "@/lib/ai/vision";
import { isRateLimitError } from "@/lib/ai/response";
import type { OcrApiResponse, OcrErrorCode } from "@/lib/answer-checker/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MIME types Gemini vision can process for a photographed answer script. */
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

/** Hard cap on the decoded upload (~6 MB) to bound cost and payload size. */
const MAX_DECODED_BYTES = 6 * 1024 * 1024;
/** base64 expands bytes by ~4/3; cap the encoded string accordingly. */
const MAX_BASE64_CHARS = Math.ceil((MAX_DECODED_BYTES * 4) / 3) + 4;

/** Handwriting-tuned transcription instruction (Urdu/Arabic script aware). */
const OCR_PROMPT =
  "This is a photograph of a student's handwritten exam answer. Transcribe ALL of the text exactly as written. Preserve line breaks and paragraph structure. Keep any Urdu or Arabic script verbatim (do not transliterate). Fix nothing and add nothing. Output ONLY the transcribed text with no commentary, labels, or markdown.";

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

const STATUS_BY_CODE: Record<OcrErrorCode, number> = {
  INVALID_BODY: 400,
  UNSUPPORTED_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
};

function jsonError(code: OcrErrorCode, message: string): Response {
  const body: OcrApiResponse = { ok: false, error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

/** Strip an optional `data:<mime>;base64,` prefix and all whitespace. */
function normaliseBase64(raw: string): string {
  const withoutPrefix = raw.includes("base64,")
    ? raw.slice(raw.indexOf("base64,") + "base64,".length)
    : raw;
  return withoutPrefix.replace(/\s+/g, "");
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(
      "INVALID_BODY",
      "Provide both imageBase64 and mimeType strings."
    );
  }

  const mimeType = parsed.data.mimeType.toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
    return jsonError(
      "UNSUPPORTED_TYPE",
      `Unsupported file type "${mimeType}". Upload a PNG, JPEG, WEBP image or a PDF.`
    );
  }

  const base64 = normaliseBase64(parsed.data.imageBase64);
  if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return jsonError("INVALID_BODY", "imageBase64 is not valid base64 data.");
  }
  if (base64.length > MAX_BASE64_CHARS) {
    return jsonError(
      "PAYLOAD_TOO_LARGE",
      `Image is too large. Please upload a file under ${Math.round(
        MAX_DECODED_BYTES / (1024 * 1024)
      )} MB.`
    );
  }

  try {
    const text = await extractTextFromImage(base64, mimeType, OCR_PROMPT);
    const body: OcrApiResponse = { ok: true, data: { text: text.trim() } };
    return Response.json(body, { status: 200 });
  } catch (err) {
    if (isRateLimitError(err)) {
      console.error("[ocr] upstream rate limited:", err);
      return jsonError(
        "RATE_LIMITED",
        "OCR is busy right now. Please try again shortly."
      );
    }
    console.error("[ocr] transcription failed:", err);
    return jsonError(
      "UPSTREAM_ERROR",
      "Could not read text from the image. Try a clearer, well-lit photo."
    );
  }
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
