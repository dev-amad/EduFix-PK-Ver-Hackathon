/**
 * scripts/diag-retrieval.ts
 * -----------------------------------------------------------------------------
 * Retrieval diagnostic: for each subject, runs representative queries through
 * the SAME searchKnowledgeBase() path the app uses and prints the top-K hits
 * (similarity + a content snippet). Purpose:
 *   1. PROVE the multilingual re-embed works — Urdu queries must return Urdu
 *      script chunks (not empty, not English) at sane similarities.
 *   2. Show the real per-subject score bands so RAG_SIMILARITY_THRESHOLD can be
 *      set from evidence (English subjects score higher in absolute cosine than
 *      Urdu with this model, so a single global threshold may not fit both).
 *
 * Queries are in-source UTF-8 (NOT argv) so Urdu survives the Windows console.
 *
 *   npx tsx scripts/diag-retrieval.ts
 * -----------------------------------------------------------------------------
 */
import { loadEnvFile } from "./lib/load-env";
import { searchKnowledgeBase } from "@/lib/rag/search";
import { getServerEnv } from "@/lib/env";
import type { SubjectId } from "@/lib/subjects";

loadEnvFile();

interface Probe {
  subject: SubjectId;
  label: string;
  query: string;
}

const PROBES: Probe[] = [
  { subject: "pak-studies", label: "relevant", query: "Causes of the failure of the Khilafat Movement 1919-1924" },
  { subject: "pak-studies", label: "off-topic", query: "Derivation of quantum entanglement equations in particle physics" },
  { subject: "islamiyat", label: "relevant", query: "Events and significance of the Hijrah, the migration to Madinah" },
  { subject: "islamiyat", label: "off-topic", query: "Method and ingredients for baking a chocolate layer cake" },
  { subject: "urdu", label: "exam-skill", query: "مضمون نویسی کے اصول اور اہمیت" },
  { subject: "urdu", label: "comprehension", query: "فہم اور ادراک کے سوالات کے جوابات" },
  { subject: "urdu", label: "off-topic", query: "کمپیوٹر سائنس اور پروگرامنگ کی تاریخ" },
];

function snippet(text: string, n = 90): string {
  return text.replace(/\s+/g, " ").trim().slice(0, n);
}

async function main() {
  const env = getServerEnv();
  console.log(`Provider : ${env.EMBEDDING_PROVIDER}`);
  console.log(`Model    : ${env.LOCAL_EMBEDDING_MODEL}`);
  console.log(`Threshold default: ${env.RAG_SIMILARITY_THRESHOLD}`);
  console.log("=".repeat(78));

  for (const p of PROBES) {
    const results = await searchKnowledgeBase(p.query, {
      subject_id: p.subject,
      threshold: 0,
      topK: 3,
    });
    console.log(`\n[${p.subject}] (${p.label})  hits=${results.length}`);
    console.log(`  query: ${p.query}`);
    results.forEach((r, i) => {
      const title = r.document_title ?? r.metadata?.filename ?? "—";
      console.log(
        `  ${i + 1}. sim=${r.similarity.toFixed(4)} | ${String(title).slice(0, 40)}\n     ${snippet(r.content)}`
      );
    });
  }
  console.log("\n" + "=".repeat(78));
}

main().catch((e: unknown) => {
  console.error("Diagnostic failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
