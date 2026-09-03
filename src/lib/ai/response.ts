/**
 * Shared helpers for turning raw LLM output into validated data.
 *
 * Extracted so every generation route (Notes, Answering Assistant, Answer
 * Checker) parses model JSON and classifies upstream errors identically rather
 * than re-implementing fragile string handling per module.
 */

/**
 * Extract the outermost JSON object from a model response: strip markdown
 * fences and tolerate leading/trailing prose. Throws when no object is found.
 */
export function extractJsonObject(raw: string): unknown {
  let text = raw.trim();

  // Strip a leading ```json / ``` fence and its closing counterpart.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) {
    text = fence[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response.");
  }

  const candidate = text.slice(start, end + 1);
  return JSON.parse(candidate) as unknown;
}

/** Case-insensitive dedupe that preserves the first-seen casing. */
export function dedupePreserveCase(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Detect Groq/upstream 429 / quota / rate-limit conditions from an error. */
export function isRateLimitError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: unknown }).status;
    if (status === 429) return true;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /rate.?limit|quota/i.test(code)) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|quota|too many requests/i.test(message);
}

/**
 * Detect Groq structured-output truncation: when `max_tokens` is reached before
 * the JSON document closes, Groq hard-fails with a 400 `json_validate_failed`
 * whose `failed_generation` reads "max completion tokens reached before
 * generating a valid document". This is NOT a rate limit — it means the response
 * cap was too small for the payload, so the caller can safely retry once with a
 * larger (or uncapped) budget instead of surfacing a 502.
 */
export function isMaxTokensTruncationError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /json_validate_failed/i.test(code)) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /max completion tokens reached|json_validate_failed|failed_generation/i.test(
    message
  );
}
