/**
 * scripts/reembed-kb.ts
 * -----------------------------------------------------------------------------
 * Re-embed the EXISTING kb_chunks with Google Gemini (gemini-embedding-001,
 * 768-dim) so retrieval vectors match the query embedder once we flip
 * EMBEDDING_PROVIDER=gemini.
 *
 * Why a separate script (not ingest-kb.ts)?
 *   ingest-kb.ts re-parses PDFs and SKIPS any document that already has chunks,
 *   so it cannot re-embed rows in place. This script is NON-DESTRUCTIVE: it reads
 *   each chunk's existing `content`, re-embeds it, and UPSERTs the row by `id`
 *   (no duplicates, no re-parsing, document_id/subject_id/metadata preserved).
 *
 * Resumable:
 *   Each re-embedded row is stamped with metadata.embedding_provider = "gemini".
 *   On restart, already-stamped rows are skipped, so an interrupted run picks up
 *   where it left off with zero wasted Gemini calls.
 *
 * Rate-limit safety (per user requirements):
 *   * Texts are batched per request. Gemini embedContent caps at 100 texts/call,
 *     so --batch-size is clamped to 100 (the API ceiling; 250 is not allowed).
 *   * A configurable delay (--batch-delay, default 4000ms) paces consecutive calls.
 *   * embedWithRetry() applies exponential backoff, and honours Gemini RetryInfo /
 *     per-minute quota windows on 429s.
 *   * If a batch still fails permanently, we abort with exit code 4 and a message
 *     pointing at the fallback (RAG_SIMILARITY_THRESHOLD=0.5 + EMBEDDING_PROVIDER
 *     =local) for testing. Progress is already saved via the marker.
 *
 * Usage:
 *   npm run db:reembed                       # all subjects, batch 100, 4s delay
 *   npm run db:reembed -- --dry-run          # report what would be embedded
 *   npm run db:reembed -- --limit=200        # controlled test (first 200 rows)
 *   npm run db:reembed -- --subject=urdu     # one subject only
 *   npm run db:reembed -- --batch-delay=8000 # slower pacing if 429s appear
 *   npm run db:reembed -- --reset            # ignore markers, re-embed everything
 * -----------------------------------------------------------------------------
 */
import { loadEnvFile } from "./lib/load-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { embedTexts } from "@/lib/ai/embeddings";

loadEnvFile();

// --- CLI argument parsing (--name=value and --flag) --------------------------
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function toInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Gemini embedContent hard limit is 100 contents per request.
const GEMINI_MAX_BATCH = 100;
const EMBEDDING_MARKER = "gemini";

const SUBJECT = getArg("subject"); // e.g. "urdu" | "islamiyat" | "pak-studies"
const LIMIT = toInt(getArg("limit"), Number.POSITIVE_INFINITY);
const BATCH_SIZE = clamp(toInt(getArg("batch-size"), GEMINI_MAX_BATCH), 1, GEMINI_MAX_BATCH);
const BATCH_DELAY = Math.max(0, toInt(getArg("batch-delay"), 4000));
const PAGE_SIZE = clamp(toInt(getArg("page-size"), 500), 1, 1000);
const DRY_RUN = hasFlag("dry-run");
const RESET = hasFlag("reset");

// --- Gemini error helpers ----------------------------------------------------
// The @google/genai SDK v2 throws `ApiError extends Error` carrying a numeric
// `.status` (HTTP code) and `.message`. Raw REST errors instead nest the same
// info under `.error.{code,message,details}`. Handle BOTH shapes so rate limits
// are detected correctly (the SDK shape has no `.error` wrapper, which is why a
// naive `err.error.code` check silently misses every 429).
interface GeminiErrorLike extends Error {
  status?: number;
  code?: number;
  error?: {
    code?: number;
    status?: number;
    message?: string;
    details?: Array<Record<string, unknown>>;
  };
}

function errStatus(err: unknown): number | undefined {
  const e = err as GeminiErrorLike | undefined;
  return e?.status ?? e?.error?.status ?? e?.error?.code ?? e?.code;
}

function errText(err: unknown): string {
  const e = err as GeminiErrorLike | undefined;
  return [e?.message, e?.error?.message].filter(Boolean).join(" | ");
}

function isQuotaError(err: unknown): boolean {
  if (errStatus(err) === 429) return true;
  return /quota|rate limit|resource[_ ]exhausted|too many requests|\b429\b/i.test(
    errText(err)
  );
}

function extractRetryDelay(err: unknown): number | null {
  const e = err as GeminiErrorLike | undefined;
  const details = e?.error?.details ?? [];
  for (const d of details) {
    if (
      d &&
      typeof d === "object" &&
      d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
    ) {
      const delay = d.retryDelay;
      if (typeof delay === "string") {
        const match = delay.match(/^(\d+)s$/);
        if (match) return parseInt(match[1]!, 10) * 1000;
      }
    }
  }
  const match = errText(err).match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(parseFloat(match[1]!) * 1000);
  return null;
}

function errMessage(err: unknown): string {
  const text = errText(err);
  const status = errStatus(err);
  if (text) return status ? `[${status}] ${text}` : text;
  return String(err);
}

async function embedWithRetry(texts: string[], retries = 8): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await embedTexts(texts);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const retryDelay = extractRetryDelay(err);
      let delay: number;
      if (retryDelay) {
        delay = retryDelay;
      } else if (isQuotaError(err)) {
        // Gemini free-tier quota resets per minute; back off a full window.
        delay = 60000 + attempt * 5000;
      } else {
        delay = Math.min(1000 * 2 ** attempt, 32000);
      }
      const status = errStatus(err);
      const tag = isQuotaError(err) ? "quota/429" : status ? `error ${status}` : "error";
      const detail = errText(err).slice(0, 160) || "no message";
      console.warn(
        `  -> embed attempt ${attempt + 1}/${retries + 1} failed (${tag}): ${detail} | retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

// --- DB access ---------------------------------------------------------------
interface ChunkRow {
  id: string;
  document_id: string | null;
  subject_id: string;
  content: string;
  metadata: Record<string, unknown>;
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function fetchPage(supabase: Admin, lastId: string | null): Promise<ChunkRow[]> {
  let q = supabase
    .from("kb_chunks")
    .select("id, document_id, subject_id, content, metadata")
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (lastId) q = q.gt("id", lastId);
  if (SUBJECT) q = q.eq("subject_id", SUBJECT);
  const { data, error } = await q;
  if (error) throw new Error(`fetchPage failed: ${error.message}`);
  return (data ?? []) as ChunkRow[];
}

async function countChunks(supabase: Admin): Promise<number> {
  let q = supabase.from("kb_chunks").select("*", { count: "exact", head: true });
  if (SUBJECT) q = q.eq("subject_id", SUBJECT);
  const { count, error } = await q;
  if (error) throw new Error(`count failed: ${error.message}`);
  return count ?? 0;
}

// --- Main --------------------------------------------------------------------
async function main() {
  const supabase = createSupabaseAdminClient();
  const total = await countChunks(supabase);

  console.log("=".repeat(72));
  console.log("kb_chunks re-embedding (Gemini gemini-embedding-001, 768-dim)");
  console.log("=".repeat(72));
  console.log(`  subject filter : ${SUBJECT ?? "ALL"}`);
  console.log(`  rows in scope  : ${total}`);
  console.log(`  batch size     : ${BATCH_SIZE} (Gemini max ${GEMINI_MAX_BATCH})`);
  console.log(`  batch delay    : ${BATCH_DELAY}ms`);
  console.log(`  page size      : ${PAGE_SIZE}`);
  console.log(`  limit          : ${Number.isFinite(LIMIT) ? LIMIT : "none"}`);
  console.log(`  reset markers  : ${RESET}`);
  console.log(`  mode           : ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  if (total === 0) {
    console.log("No chunks in scope. Nothing to do.");
    return;
  }

  let lastId: string | null = null;
  let scanned = 0;
  let skippedMarked = 0;
  let skippedEmpty = 0;
  let updated = 0;
  let pages = 0;
  let firstBatch = true;
  const startedAt = Date.now();

  outer: while (true) {
    const rows = await fetchPage(supabase, lastId);
    if (rows.length === 0) break;
    pages++;
    lastId = rows[rows.length - 1]!.id;

    // Decide which rows still need embedding.
    const todo: ChunkRow[] = [];
    for (const r of rows) {
      scanned++;
      if (!RESET && r.metadata?.embedding_provider === EMBEDDING_MARKER) {
        skippedMarked++;
        continue;
      }
      if (!r.content || !r.content.trim()) {
        skippedEmpty++;
        continue;
      }
      todo.push(r);
    }

    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      if (updated >= LIMIT) break outer;
      const batch = todo.slice(i, i + BATCH_SIZE);

      if (DRY_RUN) {
        updated += batch.length;
        console.log(
          `[dry-run] batch of ${batch.length} (subject=${batch[0]!.subject_id}) -> would embed; running total ${updated}`
        );
        continue;
      }

      // Pace consecutive Gemini calls (no trailing sleep after the last batch).
      if (!firstBatch && BATCH_DELAY > 0) await sleep(BATCH_DELAY);
      firstBatch = false;

      const t0 = Date.now();
      let embeddings: number[][];
      try {
        embeddings = await embedWithRetry(batch.map((r) => r.content));
      } catch (err) {
        console.error("");
        console.error(`Batch permanently failed after retries: ${errMessage(err)}`);
        console.error(
          "Persistent free-tier rate limits? Apply the fallback for testing:"
        );
        console.error(
          "  .env.local -> RAG_SIMILARITY_THRESHOLD=0.5  and  EMBEDDING_PROVIDER=local"
        );
        console.error(
          "Progress is saved via metadata.embedding_provider; re-run to resume."
        );
        process.exit(4);
      }

      const stamped = new Date().toISOString();
      const upsertRows = batch.map((r, k) => ({
        id: r.id,
        document_id: r.document_id,
        subject_id: r.subject_id,
        content: r.content,
        metadata: {
          ...(r.metadata ?? {}),
          embedding_provider: EMBEDDING_MARKER,
          embedded_at: stamped,
        },
        embedding: embeddings[k],
      }));

      const { error } = await supabase
        .from("kb_chunks")
        .upsert(upsertRows, { onConflict: "id" });
      if (error) throw new Error(`upsert failed: ${error.message}`);

      updated += batch.length;
      const dt = Date.now() - t0;
      const elapsedS = (Date.now() - startedAt) / 1000;
      const rate = elapsedS > 0 ? updated / elapsedS : 0;
      const target = Number.isFinite(LIMIT) ? Math.min(LIMIT, total) : total;
      const etaS = rate > 0 ? Math.max(0, (target - updated) / rate) : 0;
      const limitTag = Number.isFinite(LIMIT) ? `/${LIMIT}` : "";
      console.log(
        `  embedded ${updated}${limitTag} | +${batch.length} in ${dt}ms | ` +
          `skipped ${skippedMarked} marked, ${skippedEmpty} empty | ` +
          `${rate.toFixed(1)}/s | ETA ~${Math.round(etaS)}s`
      );
    }

    if (updated >= LIMIT) break;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`Re-embedding summary (${DRY_RUN ? "DRY RUN" : "LIVE"}):`);
  console.log(`  pages scanned            : ${pages}`);
  console.log(`  rows scanned             : ${scanned}`);
  console.log(`  re-embedded with gemini  : ${updated}`);
  console.log(`  skipped (already gemini) : ${skippedMarked}`);
  console.log(`  skipped (empty content)  : ${skippedEmpty}`);
  console.log(`  elapsed                  : ${elapsed}s`);

  if (!DRY_RUN && updated > 0) {
    console.log("");
    console.log("Next steps to activate Gemini retrieval:");
    console.log("  1. .env.local -> EMBEDDING_PROVIDER=gemini");
    console.log("  2. restart the dev server");
    console.log("  3. npm run test:e2e");
  }
  if (Number.isFinite(LIMIT) && updated >= LIMIT) {
    console.log("");
    console.log(`Reached --limit=${LIMIT}. Re-run without --limit to continue (resumable).`);
  }
}

main().catch((err) => {
  console.error("Re-embedding failed:", errMessage(err));
  process.exit(1);
});
