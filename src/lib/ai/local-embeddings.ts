/**
 * Local embedding adapter (used when EMBEDDING_PROVIDER=local).
 *
 * The model is configurable via LOCAL_EMBEDDING_MODEL and defaults to
 * Xenova/paraphrase-multilingual-mpnet-base-v2 — a 768-dim MULTILINGUAL model
 * that embeds Urdu as well as English. (all-mpnet-base-v2 is English-only, which
 * is why Urdu retrieval previously failed.) 768 dims matches kb_chunks.embedding,
 * so no schema migration is needed. Query embeddings MUST use the same model that
 * embedded the stored kb_chunks. Loaded lazily from search.ts.
 */
import { getServerEnv } from "@/lib/env";

type LocalEmbedder = (
  text: string,
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: ArrayLike<number> }>;

let extractorPromise: Promise<LocalEmbedder> | null = null;

function getLocalEmbedder(): Promise<LocalEmbedder> {
  if (!extractorPromise) {
    const model = getServerEnv().LOCAL_EMBEDDING_MODEL;
    extractorPromise = import("@xenova/transformers").then(
      async ({ pipeline, env }) => {
        // Use the HF hub/cache; don't probe a local ./models directory.
        env.allowLocalModels = false;
        const extractor = await pipeline("feature-extraction", model);
        return extractor as unknown as LocalEmbedder;
      }
    );
  }

  return extractorPromise;
}

export async function embedTextLocal(text: string): Promise<number[]> {
  const embedder = await getLocalEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}
