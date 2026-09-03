import { getServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/ai/embeddings";
import {
  ALLOWED_SUBJECT_IDS,
  assertSubjectId,
  isSubjectId,
  type SubjectId,
} from "@/lib/subjects";

/**
 * Task 2.3 — Standalone RAG vector search.
 *
 * This module is the retrieval guardrail for all EduFix PK generation flows:
 *   * queries are embedded with the same Gemini model used during ingestion
 *   * matching happens inside Postgres via the match_kb_chunks RPC
 *   * subject_id filtering is mandatory and enforced before any database call
 *   * the strict pass returns only chunks with cosine similarity >= threshold
 *   * FALLBACK: if that strict, metadata-filtered pass returns zero chunks, the
 *     query is re-run on pure vector similarity (top 10, no metadata filter, no
 *     threshold gate) so the LLM context engine always receives text chunks.
 *     Subject isolation is NEVER relaxed — the fallback stays within subject_id.
 *
 * The file can be imported by Next.js server code, or run directly for testing:
 *
 *   npx tsx src/lib/rag/search.ts \
 *     --subject=pak-studies \
 *     --query="What were the main causes of the 1857 uprising?"
 */

export { ALLOWED_SUBJECT_IDS, assertSubjectId, isSubjectId };
export type { SubjectId };

export interface SearchFilters {
  category?: string;
  paper_code?: string;
  year?: number;
  session?: string;
  /**
   * Hard sub-topic isolation filter. match_kb_chunks keeps chunks whose
   * metadata.sub_topic equals this slug OR is generic/untagged (NULL / 'general%'),
   * excluding chunks deterministically tagged as a DIFFERENT specific sub-topic.
   */
  sub_topic?: string;
}

export interface VectorSearchOptions {
  subject_id: SubjectId;
  filters?: SearchFilters;
  threshold?: number;
  topK?: number;
}

export interface VectorSearchResult {
  chunk_id: string;
  document_id: string;
  subject_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  document_title: string | null;
  document_category: string | null;
  document_year: number | null;
  document_session: string | null;
  document_paper_code: string | null;
}

interface MatchKbChunksRow {
  chunk_id: string;
  document_id: string;
  subject_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  document_title: string | null;
  document_category: string | null;
  document_year: number | null;
  document_session: string | null;
  document_paper_code: string | null;
}

async function embedQuery(text: string): Promise<number[]> {
  const env = getServerEnv();

  if (env.EMBEDDING_PROVIDER === "local") {
    const { embedTextLocal } = await import("@/lib/ai/local-embeddings");
    return embedTextLocal(text);
  }

  return embedText(text);
}

/**
 * Retrieval fallback tuning. When the strict, metadata-filtered pass returns
 * nothing, searchKnowledgeBase re-queries on pure vector similarity with these
 * settings: the top 10 nearest chunks and a 0 threshold (no similarity gate), so
 * a result is guaranteed whenever the subject has any embedded chunks at all.
 */
const FALLBACK_TOP_K = 10;
const FALLBACK_THRESHOLD = 0;

interface RunMatchArgs {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  queryEmbedding: number[];
  subjectId: SubjectId;
  threshold: number;
  topK: number;
  filters: {
    category: string | null;
    paper_code: string | null;
    year: number | null;
    session: string | null;
    sub_topic: string | null;
  };
}

/**
 * A single match_kb_chunks RPC call plus row mapping, shared by the strict pass
 * and the empty-result fallback so the two stay identical except for their
 * filters, threshold and top_k. Rows below the pass's own threshold are dropped
 * (the RPC already gates on it; this is a defensive re-check).
 */
async function runMatchKbChunks({
  supabase,
  queryEmbedding,
  subjectId,
  threshold,
  topK,
  filters,
}: RunMatchArgs): Promise<VectorSearchResult[]> {
  const { data, error } = await supabase.rpc("match_kb_chunks", {
    query_embedding: queryEmbedding,
    match_subject_id: subjectId,
    match_threshold: threshold,
    match_top_k: topK,
    match_category: filters.category,
    match_paper_code: filters.paper_code,
    match_year: filters.year,
    match_session: filters.session,
    match_sub_topic: filters.sub_topic,
  });

  if (error) {
    throw new Error(`kb_chunks vector search failed: ${error.message}`);
  }

  const rows = (data ?? []) as MatchKbChunksRow[];

  return rows
    .filter((row) => Number.isFinite(row.similarity) && row.similarity >= threshold)
    .map((row) => ({
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      subject_id: row.subject_id,
      content: row.content,
      metadata: row.metadata,
      similarity: row.similarity,
      document_title: row.document_title,
      document_category: row.document_category,
      document_year: row.document_year,
      document_session: row.document_session,
      document_paper_code: row.document_paper_code,
    }));
}

export async function searchKnowledgeBase(
  query: string,
  options: VectorSearchOptions
): Promise<VectorSearchResult[]> {
  const env = getServerEnv();

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("RAG search query must be a non-empty string.");
  }

  const subjectId = assertSubjectId(options.subject_id);

  const threshold = options.threshold ?? env.RAG_SIMILARITY_THRESHOLD;
  if (threshold < 0 || threshold > 1) {
    throw new Error(`RAG threshold must be between 0 and 1, got ${threshold}.`);
  }

  const topK = Math.max(1, Math.min(options.topK ?? 5, 50));

  const queryEmbedding = await embedQuery(trimmedQuery);
  if (queryEmbedding.length !== env.EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Query embedding dimension mismatch: expected ${env.EMBEDDING_DIMENSIONS}, got ${queryEmbedding.length}.`
    );
  }

  const supabase = createSupabaseAdminClient();

  // Step 1 — strict pass: subject isolation + every metadata filter + the
  // similarity threshold. This is the normal, precise retrieval path.
  const strictResults = await runMatchKbChunks({
    supabase,
    queryEmbedding,
    subjectId,
    threshold,
    topK,
    filters: {
      category: options.filters?.category ?? null,
      paper_code: options.filters?.paper_code ?? null,
      year: options.filters?.year ?? null,
      session: options.filters?.session ?? null,
      sub_topic: options.filters?.sub_topic ?? null,
    },
  });

  if (strictResults.length > 0) {
    return strictResults;
  }

  // Step 2 — fallback pass: the strict query returned zero chunks, so re-query
  // on PURE vector similarity (top 10) with NO metadata filter and no threshold
  // gate. This guarantees the LLM context engine always receives text chunks
  // whenever the subject has any embedded content at all.
  //
  // NON-NEGOTIABLE: subject isolation (match_subject_id) is STILL enforced — the
  // fallback never crosses subjects (rules.md §2). Only the category /
  // paper_code / year / session / sub_topic metadata filters and the similarity
  // threshold are relaxed.
  console.warn(
    `[rag] strict retrieval returned 0 chunks (subject=${subjectId}, ` +
      `threshold=${threshold}, topK=${topK}); falling back to pure vector ` +
      `similarity (top_k=${FALLBACK_TOP_K}, no metadata filter).`
  );

  return runMatchKbChunks({
    supabase,
    queryEmbedding,
    subjectId,
    threshold: FALLBACK_THRESHOLD,
    topK: FALLBACK_TOP_K,
    filters: {
      category: null,
      paper_code: null,
      year: null,
      session: null,
      sub_topic: null,
    },
  });
}

export async function runSearchTest(options: {
  query: string;
  subject_id: SubjectId;
  filters?: SearchFilters;
  threshold?: number;
  topK?: number;
}): Promise<VectorSearchResult[]> {
  const results = await searchKnowledgeBase(options.query, {
    subject_id: options.subject_id,
    filters: options.filters,
    threshold: options.threshold,
    topK: options.topK,
  });

  console.log(
    `RAG test: subject=${options.subject_id} threshold=${
      options.threshold ?? getServerEnv().RAG_SIMILARITY_THRESHOLD
    } topK=${options.topK ?? 5} results=${results.length}`
  );

  for (const result of results) {
    console.log(
      `- [${result.similarity.toFixed(4)}] ${result.document_title ?? "Unknown document"} :: ${result.content.slice(
        0,
        160
      )}...`
    );
  }

  return results;
}

interface CliArgs {
  subject?: string;
  query?: string;
  category?: string;
  paper_code?: string;
  year?: number;
  session?: string;
  sub_topic?: string;
  top?: number;
  threshold?: number;
  help?: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");

    switch (rawKey) {
      case "subject":
        args.subject = value;
        break;
      case "query":
        args.query = value;
        break;
      case "category":
        args.category = value;
        break;
      case "paper_code":
        args.paper_code = value;
        break;
      case "year":
        args.year = Number(value);
        break;
      case "session":
        args.session = value;
        break;
      case "sub_topic":
        args.sub_topic = value;
        break;
      case "top":
        args.top = Number(value);
        break;
      case "threshold":
        args.threshold = Number(value);
        break;
      case "help":
        args.help = true;
        break;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/lib/rag/search.ts --subject=<pak-studies|islamiyat|urdu> --query="<text>" [options]

Options:
  --subject=<subject_id>     Required. One of: ${ALLOWED_SUBJECT_IDS.join(", ")}
  --query="<text>"           Required. Search query.
  --category=<category>      Optional metadata filter.
  --paper_code=<code>        Optional metadata filter, e.g. 2059/1.
  --year=<year>              Optional metadata filter, e.g. 2022.
  --session=<session>        Optional metadata filter, e.g. "May/June".
  --sub_topic=<slug>         Optional hard isolation filter, e.g. battle_of_badr_624ad.
  --top=<n>                  Number of results to return. Default: 5. Max: 50.
  --threshold=<0-1>          Cosine similarity threshold. Default: RAG_SIMILARITY_THRESHOLD.
  --help                     Show this help message.
`);
}

async function runCli(): Promise<void> {
  const { loadEnvFile } = await import("../../../scripts/lib/load-env");
  loadEnvFile();

  const args = parseCliArgs(process.argv.slice(2));

  if (args.help || !args.subject || !args.query) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const filters: SearchFilters = {};
  if (args.category) filters.category = args.category;
  if (args.paper_code) filters.paper_code = args.paper_code;
  if (Number.isFinite(args.year)) filters.year = args.year;
  if (args.session) filters.session = args.session;
  if (args.sub_topic) filters.sub_topic = args.sub_topic;

  const results = await searchKnowledgeBase(args.query, {
    subject_id: assertSubjectId(args.subject),
    filters,
    threshold: Number.isFinite(args.threshold) ? args.threshold : undefined,
    topK: Number.isFinite(args.top) ? args.top : undefined,
  });

  console.log(
    JSON.stringify(
      {
        subject: args.subject,
        query: args.query,
        filters,
        threshold: args.threshold ?? getServerEnv().RAG_SIMILARITY_THRESHOLD,
        topK: args.top ?? 5,
        resultCount: results.length,
        results,
      },
      null,
      2
    )
  );
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  return (
    typeof entry === "string" &&
    /src[\\/]lib[\\/]rag[\\/]search\.(ts|js)$/.test(entry)
  );
})();

if (isDirectRun) {
  runCli().catch((error) => {
    console.error("RAG search failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
