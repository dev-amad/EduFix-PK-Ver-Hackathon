import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { getServerEnv } from "@/lib/env";

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

/**
 * Run a chat completion against the Groq-hosted LLM.
 *
 * Temperature is pinned to 0.1 by default (rules.md §2) to minimize
 * hallucination. Only override for a documented, deliberate reason.
 */
export async function groqChat(
  messages: ChatCompletionMessageParam[],
  options: { temperature?: number; maxTokens?: number; json?: boolean } = {}
): Promise<string> {
  const env = getServerEnv();
  const completion = await getGroqClient().chat.completions.create({
    model: env.GROQ_MODEL,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens,
    response_format: options.json ? { type: "json_object" } : undefined,
  });

  const content = completion.choices[0]?.message?.content;
  if (content == null) {
    throw new Error("Groq returned an empty completion.");
  }
  return content;
}
