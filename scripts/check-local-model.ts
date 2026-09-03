/**
 * scripts/check-local-model.ts
 * -----------------------------------------------------------------------------
 * One-off validation for a candidate LOCAL embedding model before we re-point
 * the KB at it. Confirms three things:
 *   1. It loads via @xenova/transformers (the same path local-embeddings.ts uses).
 *   2. It outputs 768 dims — must match kb_chunks.embedding VECTOR(768), so no
 *      schema migration is needed.
 *   3. It aligns Urdu <-> English semantically (all-mpnet-base-v2 is English-only
 *      and cannot do this; that is exactly why Urdu retrieval fails today).
 *
 * Urdu test text is kept in-source as UTF-8 (NOT passed via argv) to avoid the
 * Windows PowerShell console encoding problem.
 *
 * Run:
 *   npx tsx scripts/check-local-model.ts
 *   npx tsx scripts/check-local-model.ts Xenova/paraphrase-multilingual-mpnet-base-v2
 * -----------------------------------------------------------------------------
 */
import { pipeline, env as tfEnv } from "@xenova/transformers";

// Force download from the HF hub (don't look for a local models/ dir).
tfEnv.allowLocalModels = false;

const MODEL =
  process.argv[2] ?? "Xenova/paraphrase-multilingual-mpnet-base-v2";

// Same meaning, different script -> a real multilingual model scores these HIGH.
const EN = "Cricket is the most popular sport in Pakistan.";
const UR_PARALLEL = "کرکٹ پاکستان کا سب سے مقبول کھیل ہے۔";
// Different meaning -> should score clearly LOWER than the parallel pair.
const UR_OTHER = "بانی پاکستان قائد اعظم محمد علی جناح تھے۔";

type Extractor = (
  text: string,
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: ArrayLike<number> }>;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embed(ex: Extractor, text: string): Promise<number[]> {
  const out = await ex(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

async function main() {
  console.log(`Model: ${MODEL}`);
  console.log("Loading (first run downloads the ONNX weights, ~1-3 min)...");
  const t0 = Date.now();
  const extractor = (await pipeline(
    "feature-extraction",
    MODEL
  )) as unknown as Extractor;
  console.log(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const vEn = await embed(extractor, EN);
  const vUrP = await embed(extractor, UR_PARALLEL);
  const vUrO = await embed(extractor, UR_OTHER);

  console.log(
    `Dimensions: EN=${vEn.length} UR_parallel=${vUrP.length} UR_other=${vUrO.length} (need 768)`
  );

  const sParallel = cosine(vEn, vUrP); // same meaning, cross-lingual -> HIGH
  const sOther = cosine(vEn, vUrO); // different meaning -> LOWER
  const sUrUr = cosine(vUrP, vUrO); // both Urdu, different meaning

  console.log(
    `\ncos(EN, UR_parallel [same meaning]) = ${sParallel.toFixed(4)}   <- want HIGH`
  );
  console.log(
    `cos(EN, UR_other    [diff meaning]) = ${sOther.toFixed(4)}   <- want LOWER`
  );
  console.log(`cos(UR_parallel, UR_other)          = ${sUrUr.toFixed(4)}`);

  const dimOk =
    vEn.length === 768 && vUrP.length === 768 && vUrO.length === 768;
  const alignOk = sParallel > sOther + 0.05; // parallel pair clearly closer
  const nonDegenerate = vUrP.some((x) => x !== 0) && sUrUr < 0.999;

  console.log(
    `\nRESULT: dims768=${dimOk ? "PASS" : "FAIL"} | ` +
      `cross-lingual=${alignOk ? "PASS" : "WEAK"} | ` +
      `non-degenerate=${nonDegenerate ? "PASS" : "FAIL"}`
  );

  process.exit(dimOk && nonDegenerate ? 0 : 1);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Model check failed:", msg);
  process.exit(1);
});
