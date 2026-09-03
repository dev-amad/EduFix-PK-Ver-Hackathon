import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { getServerEnv } from "@/lib/env";
import { isRateLimitError } from "@/lib/ai/response";

let client: Groq | null = null;

/** Lazily construct the singleton Groq client (OpenAI-compatible API). */
export function getGroqClient(): Groq {
  if (!client) {
    const env = getServerEnv();
    client = new Groq({
      apiKey: env.GROQ_API_KEY,
      baseURL: env.GROQ_BASE_URL,
    });
  }
  return client;
}

/** Shared completion options for a single Groq call. */
interface GroqChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

/**
 * Run ONE chat completion against a specific model. Throws on any upstream
 * error (rate limit, auth, bad request) or an empty completion.
 */
async function completeWithModel(
  model: string,
  messages: ChatCompletionMessageParam[],
  options: GroqChatOptions
): Promise<string> {
  const completion = await getGroqClient().chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens,
    response_format: options.json ? { type: "json_object" } : undefined,
  });

  const content = completion.choices[0]?.message?.content;
  if (content == null) {
    throw new Error(`Groq returned an empty completion from ${model}.`);
  }
  return content;
}

/**
 * Run a chat completion against the Groq-hosted LLM.
 *
 * Temperature is pinned to 0.1 by default (rules.md §2) to minimize
 * hallucination. Only override for a documented, deliberate reason.
 *
 * QUOTA RESILIENCE: Groq's free-tier TPM (per-minute) and TPD (per-day) token
 * budgets are PER-MODEL. When the primary model (GROQ_MODEL) is rate-limited
 * (429), this transparently retries the SAME request against each model listed
 * in GROQ_FALLBACK_MODEL (comma-separated) — a different model has an
 * independent budget, so a daily-quota 429 on one no longer hard-fails the
 * request. ONLY rate-limit/quota errors fall through; any other error (auth,
 * schema, bad request) is rethrown immediately so real bugs still surface. When
 * the primary is healthy the fallbacks are never touched, so behaviour is
 * unchanged for Notes, the Answering Assistant and the Answer Checker alike.
 */
export async function groqChat(
  messages: ChatCompletionMessageParam[],
  options: GroqChatOptions = {}
): Promise<string> {
  const env = getServerEnv();
  const primary = env.GROQ_MODEL;
  const fallbacks = env.GROQ_FALLBACK_MODEL.split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0 && model !== primary);

  const chain = [primary, ...fallbacks];
  for (let i = 0; i < chain.length; i++) {
    try {
      return await completeWithModel(chain[i], messages, options);
    } catch (err) {
      const isLast = i === chain.length - 1;
      if (isLast || !isRateLimitError(err)) throw err;
      console.warn(
        `[groq] model "${chain[i]}" rate-limited; retrying on "${chain[i + 1]}".`
      );
    }
  }
  // Unreachable: the loop either returns or throws on the final model.
  throw new Error("Groq completion failed.");
}
