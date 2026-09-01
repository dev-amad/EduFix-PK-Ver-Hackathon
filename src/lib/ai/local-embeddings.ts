/**
 * Local embedding adapter for KBs ingested with scripts/manual-ingest.ts.
 *
 * The stored vectors in those KBs were generated with
 * Xenova/all-mpnet-base-v2, so query embeddings must use the same model.
 * This module is intentionally loaded lazily from search.ts only when
 * EMBEDDING_PROVIDER=local.
 */

type LocalEmbedder = (
  text: string,
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: ArrayLike<number> }>;

let extractorPromise: Promise<LocalEmbedder> | null = null;

function getLocalEmbedder(): Promise<LocalEmbedder> {
  if (!extractorPromise) {
    extractorPromise = import("@xenova/transformers").then(async ({ pipeline }) => {
      const extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-mpnet-base-v2"
      );
      return extractor as unknown as LocalEmbedder;
    });
  }

  return extractorPromise;
}

export async function embedTextLocal(text: string): Promise<number[]> {
  const embedder = await getLocalEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}
