/**
 * scripts/calibrate-threshold.ts
 * -----------------------------------------------------------------------------
 * Prints top-K cosine similarities for representative RELEVANT vs IRRELEVANT
 * queries per subject so RAG_SIMILARITY_THRESHOLD can be set from REAL data for
 * the multilingual local model (its score distribution differs from Gemini's,
 * which is what the 0.78 default was calibrated for).
 *
 * Queries are in-source UTF-8 (NOT argv) so Urdu is not mangled by the Windows
 * PowerShell console. Uses the same searchKnowledgeBase() path as the app, so it
 * honours EMBEDDING_PROVIDER (must be "local" to use the multilingual model).
 *
 * Run AFTER re-embedding:
 *   npx tsx scripts/calibrate-threshold.ts
 * -----------------------------------------------------------------------------
 */
import { loadEnvFile } from "./lib/load-env";
import { searchKnowledgeBase } from "@/lib/rag/search";
import { getServerEnv } from "@/lib/env";
import type { SubjectId } from "@/lib/subjects";

loadEnvFile();

interface Probe {
  subject: SubjectId;
  label: "RELEVANT" | "IRRELEVANT";
  query: string;
}

const PROBES: Probe[] = [
  {
    subject: "pak-studies",
    label: "RELEVANT",
    query: "Causes and reasons for the failure of the Khilafat Movement 1919-1924",
  },
  {
    subject: "pak-studies",
    label: "IRRELEVANT",
    query: "Derivation of quantum entanglement equations in particle physics",
  },
  {
    subject: "islamiyat",
    label: "RELEVANT",
    query: "Events and significance of the Hijrah, the migration to Madinah",
  },
  {
    subject: "islamiyat",
    label: "IRRELEVANT",
    query: "Method and ingredients for baking a chocolate layer cake",
  },
  {
    subject: "urdu",
    label: "RELEVANT",
    query: "کرکٹ کے کھیل کی اہمیت اور اس کے فوائد",
  },
  {
    subject: "urdu",
    label: "IRRELEVANT",
    query: "کمپیوٹر سائنس اور پروگرامنگ کی تاریخ",
  },
];

async function main() {
  const env = getServerEnv();
  const topK = 5;
  console.log(`Provider : ${env.EMBEDDING_PROVIDER}`);
  console.log(`Model    : ${env.LOCAL_EMBEDDING_MODEL}`);
  console.log(`Current RAG_SIMILARITY_THRESHOLD default: ${env.RAG_SIMILARITY_THRESHOLD}`);
  console.log("=".repeat(72));

  const relevantTops: number[] = [];
  const irrelevantTops: number[] = [];

  for (const p of PROBES) {
    const results = await searchKnowledgeBase(p.query, {
      subject_id: p.subject,
      threshold: 0,
      topK,
    });
    const sims = results.map((r) => r.similarity);
    const top = sims.length ? Math.max(...sims) : 0;
    if (p.label === "RELEVANT") relevantTops.push(top);
    else irrelevantTops.push(top);
    const list = sims.map((s) => s.toFixed(4)).join(", ");
    console.log(
      `[${p.subject.padEnd(11)}] ${p.label.padEnd(11)} top=${top.toFixed(4)} | [${list}]`
    );
    console.log(`             query: ${p.query}`);
  }

  console.log("=".repeat(72));
  const minRelevant = relevantTops.length ? Math.min(...relevantTops) : 0;
  const maxIrrelevant = irrelevantTops.length ? Math.max(...irrelevantTops) : 0;
  console.log(`lowest RELEVANT top-score   : ${minRelevant.toFixed(4)}`);
  console.log(`highest IRRELEVANT top-score: ${maxIrrelevant.toFixed(4)}`);
  const suggested = (minRelevant + maxIrrelevant) / 2;
  console.log(
    `suggested threshold (midpoint): ${suggested.toFixed(3)}  ` +
      `-> set RAG_SIMILARITY_THRESHOLD between ${maxIrrelevant.toFixed(2)} and ${minRelevant.toFixed(2)}`
  );
}

main().catch((e: unknown) => {
  console.error("Calibration failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
