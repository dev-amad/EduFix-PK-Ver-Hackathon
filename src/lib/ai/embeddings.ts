import type { Content } from "@google/genai";
import { getGeminiClient } from "./gemini";
import { getServerEnv } from "@/lib/env";

/**
 * Embed a batch of texts using Gemini text-embedding-004.
 * Returns one 768-dimensional vector per input text, in input order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const env = getServerEnv();
  const contents: Content[] = texts.map((text) => ({
    role: "user",
    parts: [{ text }],
  }));

  const response = await getGeminiClient().models.embedContent({
    model: env.GEMINI_EMBEDDING_MODEL,
    contents,
    config: {
      // Pin output size so vectors always match kb_chunks.embedding (768).
      // Gemini models default to larger native sizes (e.g. 3072).
      outputDimensionality: env.EMBEDDING_DIMENSIONS,
    },
  });

  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Gemini returned ${embeddings.length} embeddings for ${texts.length} inputs.`
    );
  }

  return embeddings.map((e, i) => {
    const values = e.values;
    if (!values) {
      throw new Error(`Gemini returned an empty embedding for input ${i}.`);
    }
    if (values.length !== env.EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch: expected ${env.EMBEDDING_DIMENSIONS}, got ${values.length}. ` +
          `kb_chunks.embedding must match the model output size.`
      );
    }
    return values;
  });
}

/** Embed a single text and return its 768-dimensional vector. */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
