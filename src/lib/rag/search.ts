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
 *   * only chunks with cosine similarity >= threshold are returned
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

  const { data, error } = await supabase.rpc("match_kb_chunks", {
    query_embedding: queryEmbedding,
    match_subject_id: subjectId,
    match_threshold: threshold,
    match_top_k: topK,
    match_category: options.filters?.category ?? null,
    match_paper_code: options.filters?.paper_code ?? null,
    match_year: options.filters?.year ?? null,
    match_session: options.filters?.session ?? null,
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
