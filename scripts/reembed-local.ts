/**
 * scripts/reembed-local.ts
 * -----------------------------------------------------------------------------
 * Re-embed ALL existing kb_chunks with the LOCAL multilingual model
 * (LOCAL_EMBEDDING_MODEL, default Xenova/paraphrase-multilingual-mpnet-base-v2).
 *
 * Why this exists:
 *   The Gemini free tier caps embedding at ~1000 chunks/DAY, so the 11,719-chunk
 *   KB cannot be re-embedded via API (it would take ~12 days). The local
 *   multilingual model runs on CPU with NO quota, outputs 768 dims (matches
 *   kb_chunks.embedding — no migration), and embeds Urdu correctly, which
 *   all-mpnet-base-v2 (English-only) could not.
 *
 * Non-destructive + resumable:
 *   Reads each chunk's existing `content`, re-embeds it, and UPSERTs the row by
 *   `id` (document_id / subject_id / metadata preserved — no duplicates, no PDF
 *   re-parsing). Each row is stamped metadata.embedding_model = <model>; rows
 *   already carrying that exact stamp are skipped, so an interrupted run resumes
 *   with no wasted work. This ALSO overwrites the ~1000 rows previously embedded
 *   with Gemini, collapsing the KB back into a single consistent vector space.
 *
 * Usage:
 *   npm run db:reembed:local                  # all subjects
 *   npm run db:reembed:local -- --dry-run     # report scope, embed nothing
 *   npm run db:reembed:local -- --subject=urdu
 *   npm run db:reembed:local -- --limit=500   # controlled test
 *   npm run db:reembed:local -- --reset       # ignore stamps, re-embed everything
 * -----------------------------------------------------------------------------
 */
import { loadEnvFile } from "./lib/load-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { embedTextLocal } from "@/lib/ai/local-embeddings";
import { getServerEnv } from "@/lib/env";

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

const env = getServerEnv();
const MODEL = env.LOCAL_EMBEDDING_MODEL;
const DIMS = env.EMBEDDING_DIMENSIONS;

const SUBJECT = getArg("subject");
const LIMIT = toInt(getArg("limit"), Number.POSITIVE_INFINITY);
const PAGE_SIZE = clamp(toInt(getArg("page-size"), 500), 1, 1000);
const UPSERT_BATCH = clamp(toInt(getArg("batch-size"), 100), 1, 500);
const DRY_RUN = hasFlag("dry-run");
const RESET = hasFlag("reset");

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
  console.log("kb_chunks LOCAL re-embedding (multilingual, no API quota)");
  console.log("=".repeat(72));
  console.log(`  model          : ${MODEL}`);
  console.log(`  dimensions     : ${DIMS}`);
  console.log(`  subject filter : ${SUBJECT ?? "ALL"}`);
  console.log(`  rows in scope  : ${total}`);
  console.log(`  upsert batch   : ${UPSERT_BATCH}`);
  console.log(`  page size      : ${PAGE_SIZE}`);
  console.log(`  limit          : ${Number.isFinite(LIMIT) ? LIMIT : "none"}`);
  console.log(`  reset stamps   : ${RESET}`);
  console.log(`  mode           : ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  if (total === 0) {
    console.log("No chunks in scope. Nothing to do.");
    return;
  }

  let lastId: string | null = null;
  let scanned = 0;
  let skippedStamped = 0;
  let skippedEmpty = 0;
  let updated = 0;
  let pages = 0;
  const startedAt = Date.now();

  outer: while (true) {
    const rows = await fetchPage(supabase, lastId);
    if (rows.length === 0) break;
    pages++;
    lastId = rows[rows.length - 1]!.id;

    const todo: ChunkRow[] = [];
    for (const r of rows) {
      scanned++;
      if (!RESET && r.metadata?.embedding_model === MODEL) {
        skippedStamped++;
        continue;
      }
      if (!r.content || !r.content.trim()) {
        skippedEmpty++;
        continue;
      }
      todo.push(r);
    }

    for (let i = 0; i < todo.length; i += UPSERT_BATCH) {
      if (updated >= LIMIT) break outer;
      const batch = todo.slice(i, i + UPSERT_BATCH);

      if (DRY_RUN) {
        updated += batch.length;
        console.log(
          `[dry-run] batch of ${batch.length} (subject=${batch[0]!.subject_id}) -> would embed; running total ${updated}`
        );
        continue;
      }

      const t0 = Date.now();
      // Local inference is CPU-bound; embed sequentially (proven by the original
      // manual-ingest run) and batch the DB writes.
      const embeddings: number[][] = [];
      for (const r of batch) {
        const vec = await embedTextLocal(r.content);
        if (vec.length !== DIMS) {
          throw new Error(
            `Dimension mismatch for chunk ${r.id}: model produced ${vec.length}, expected ${DIMS}.`
          );
        }
        embeddings.push(vec);
      }

      const stamped = new Date().toISOString();
      const upsertRows = batch.map((r, k) => ({
        id: r.id,
        document_id: r.document_id,
        subject_id: r.subject_id,
        content: r.content,
        metadata: {
          ...(r.metadata ?? {}),
          embedding_provider: "local",
          embedding_model: MODEL,
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
          `skipped ${skippedStamped} stamped, ${skippedEmpty} empty | ` +
          `${rate.toFixed(1)}/s | ETA ~${Math.round(etaS)}s`
      );
    }

    if (updated >= LIMIT) break;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`Local re-embedding summary (${DRY_RUN ? "DRY RUN" : "LIVE"}):`);
  console.log(`  model                    : ${MODEL}`);
  console.log(`  pages scanned            : ${pages}`);
  console.log(`  rows scanned             : ${scanned}`);
  console.log(`  re-embedded              : ${updated}`);
  console.log(`  skipped (already model)  : ${skippedStamped}`);
  console.log(`  skipped (empty content)  : ${skippedEmpty}`);
  console.log(`  elapsed                  : ${elapsed}s`);

  if (!DRY_RUN && updated > 0) {
    console.log("");
    console.log("Next steps:");
    console.log("  1. .env.local -> EMBEDDING_PROVIDER=local (queries use the same model)");
    console.log("  2. recalibrate RAG_SIMILARITY_THRESHOLD for this model's score range");
    console.log("  3. restart the dev server, then: npm run test:e2e");
  }
  if (Number.isFinite(LIMIT) && updated >= LIMIT) {
    console.log("");
    console.log(`Reached --limit=${LIMIT}. Re-run without --limit to continue (resumable).`);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Local re-embedding failed:", msg);
  process.exit(1);
});
