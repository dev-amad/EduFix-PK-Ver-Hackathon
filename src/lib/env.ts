import { z } from "zod";

/**
 * Centralized environment validation (Task 1.4).
 *
 * Server-only variables are validated here so that any API route or script
 * importing `env` fails fast with a readable error instead of throwing
 * cryptic runtime errors deep inside an LLM or Supabase call.
 *
 * Client-exposed variables (NEXT_PUBLIC_*) are inlined at build time by
 * Next.js; they are validated separately in `clientEnv`.
 */

const serverEnvSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1).optional(),

  // Google Gemini — embeddings (gemini-embedding-001) + vision/OCR (gemini-2.5-flash)
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  GEMINI_VISION_MODEL: z.string().default("gemini-2.5-flash"),

  // Groq — primary LLM (OpenAI-compatible API)
  // groq-sdk appends /openai/v1 automatically; baseURL must be the host root.
  GROQ_API_KEY: z.string().min(1),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  // Quota-resilience fallback(s): comma-separated Groq model id(s) retried when
  // GROQ_MODEL is rate-limited. Groq's TPM (per-minute) and TPD (per-day) token
  // budgets are PER-MODEL, so a different model has an independent pool and a
  // daily-quota 429 on the primary no longer hard-fails the request. The default
  // is qwen/qwen3.8-27b: a NON-reasoning model that emits JSON directly and
  // token-efficiently. Avoid gpt-oss-20b here — it is a reasoning model that can
  // spend the whole completion budget on hidden reasoning and return EMPTY
  // content on large-context JSON prompts (Groq then fails it with
  // json_validate_failed). Set to "" to disable the fallback.
  GROQ_FALLBACK_MODEL: z.string().default("qwen/qwen3.8-27b"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com"),

  // RAG guardrail
  // Enforced via outputDimensionality; must match kb_chunks.embedding (768).
  EMBEDDING_DIMENSIONS: z.coerce.number().default(768),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),

  // Query embeddings must use the same model family as stored kb_chunks.
  // Use "local" only for KBs embedded with scripts/reembed-local.ts (or the
  // legacy scripts/manual-ingest.ts).
  EMBEDDING_PROVIDER: z.enum(["gemini", "local"]).default("gemini"),

  // Local embedding model (when EMBEDDING_PROVIDER=local). Defaults to a 768-dim
  // MULTILINGUAL model so Urdu embeds correctly (all-mpnet-base-v2 is English-only);
  // 768 dims matches kb_chunks.embedding, so no schema migration is required.
  LOCAL_EMBEDDING_MODEL: z
    .string()
    .default("Xenova/paraphrase-multilingual-mpnet-base-v2"),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

function parseOrThrow<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv, label: string) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing ${label} environment variables:\n${issues}\n\n` +
        `Copy .env.example to .env.local and fill in the values.`
    );
  }
  return result.data;
}

let cachedServerEnv: z.infer<typeof serverEnvSchema> | null = null;

/** Validated server-side environment. Throws on first access if invalid. */
export function getServerEnv() {
  if (!cachedServerEnv) {
    cachedServerEnv = parseOrThrow(serverEnvSchema, process.env, "server");
  }
  return cachedServerEnv;
}

/** Validated client-exposed environment (NEXT_PUBLIC_* only). */
export function getClientEnv() {
  return parseOrThrow(clientEnvSchema, process.env, "client");
}

export type ServerEnv = ReturnType<typeof getServerEnv>;
export type ClientEnv = ReturnType<typeof getClientEnv>;
