/**
 * scripts/tag-provinces.ts
 * -----------------------------------------------------------------------------
 * DB METADATA UPDATE — deterministically stamp `metadata.province` on existing
 * Pakistan Studies (2059) kb_chunks, WITHOUT re-embedding and WITHOUT touching
 * content, vectors or the existing sub_topic tag.
 *
 * Why: Geography (2059/02) notes were mixing landforms across provincial
 * boundaries. This writes the province bucket (balochistan / sindh / punjab /
 * kpk_north) resolved by scripts/lib/province-tagger.ts so the metadata records
 * the correct region for inspection and downstream verification. It is the data
 * counterpart to the SPATIAL BOUNDARY MATRIX in the 2059/02 system prompt.
 *
 * Safe by construction:
 *   - Read-only unless run WITHOUT --dry-run.
 *   - Update is a JSONB merge (`metadata || jsonb_build_object('province', ...)`):
 *     every existing key (sub_topic, subject_code, filename, ...) is preserved.
 *   - ONLY chunks that resolve to a single province are written; ambiguous /
 *     no-match chunks are left untouched (no province key is ever guessed).
 *   - Reports BEFORE -> AFTER distribution, then re-queries the live DB to
 *     VERIFY the written counts and confirm sub_topic was not disturbed.
 *
 * Usage:
 *   npx tsx scripts/tag-provinces.ts --dry-run            # report only
 *   npx tsx scripts/tag-provinces.ts                      # apply (pak-studies)
 *   npx tsx scripts/tag-provinces.ts --subject=pak-studies
 *   npx tsx scripts/tag-provinces.ts --batch=2000         # update batch size
 */
import { Client } from "pg";
import { loadEnvFile } from "./lib/load-env";
import { isSubjectId } from "@/lib/subjects";
import { createProvinceTagger, type Province } from "./lib/province-tagger";

loadEnvFile();

const DRY_RUN =
  process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

function flagValue(prefix: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

// Province keywords are Pakistan-geography-specific, so the default scope is
// pak-studies (2059). Override with --subject= only if ever needed.
const SUBJECT_ARG = flagValue("--subject=") ?? "pak-studies";
const BATCH = (() => {
  const n = Number(flagValue("--batch="));
  return Number.isFinite(n) && n > 0 ? n : 2000;
})();

interface ChunkRow {
  id: string;
  subject_id: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const PROVINCES: Province[] = ["balochistan", "sindh", "punjab", "kpk_north"];

async function main(): Promise<void> {
  const connectionString =
    process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing SUPABASE_DB_URL (or DATABASE_URL) in .env.local");
    process.exit(1);
  }
  if (!isSubjectId(SUBJECT_ARG)) {
    console.error(`Unknown subject: ${SUBJECT_ARG}`);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  console.log("Connected to Supabase Postgres.");

  const { rows } = await client.query<ChunkRow>(
    `SELECT id, subject_id, content, metadata
       FROM public.kb_chunks
      WHERE subject_id = $1
      ORDER BY id`,
    [SUBJECT_ARG]
  );
  console.log(`Fetched ${rows.length} chunks for subject=${SUBJECT_ARG}.`);
  if (rows.length === 0) {
    await client.end();
    return;
  }

  const tagger = createProvinceTagger();

  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const ids: string[] = [];
  const provinces: string[] = [];
  const samples: Array<{ province: string; subTopic: string; snippet: string }> =
    [];
  const perSubTopic = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const md = row.metadata ?? {};
    const content = row.content ?? "";
    const filename = str(md.source_filename) || str(md.filename);
    const beforeProvince = str(md.province) || "(none)";
    const subTopic = str(md.sub_topic) || "(untagged)";

    before.set(beforeProvince, (before.get(beforeProvince) ?? 0) + 1);

    const resolved = tagger.tagChunk(content, filename);
    const afterProvince = resolved ?? "(none)";
    after.set(afterProvince, (after.get(afterProvince) ?? 0) + 1);

    // Only write chunks that resolve to a single, unambiguous province.
    if (resolved) {
      ids.push(row.id);
      provinces.push(resolved);

      const inner = perSubTopic.get(subTopic) ?? new Map<string, number>();
      inner.set(resolved, (inner.get(resolved) ?? 0) + 1);
      perSubTopic.set(subTopic, inner);

      if (samples.length < 8) {
        samples.push({
          province: resolved,
          subTopic,
          snippet: content.slice(0, 120).replace(/\s+/g, " "),
        });
      }
    }
  }

  const printDist = (label: string, dist: Map<string, number>): void => {
    console.log(`\n${label} province distribution (${SUBJECT_ARG}):`);
    for (const [k, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${n}`);
    }
  };

  printDist("BEFORE", before);
  printDist("AFTER (projected)", after);

  console.log("\nProvince x sub_topic (projected):");
  for (const [subTopic, prov] of [...perSubTopic.entries()].sort()) {
    const parts = PROVINCES.filter((p) => prov.get(p)).map(
      (p) => `${p}=${prov.get(p)}`
    );
    if (parts.length > 0) console.log(`  ${subTopic}: ${parts.join(", ")}`);
  }

  console.log("\nTagger stats:");
  const s = tagger.stats;
  console.log(
    `  balochistan=${s.balochistan} sindh=${s.sindh} punjab=${s.punjab} ` +
      `kpk_north=${s.kpk_north} ambiguous=${s.ambiguous} untagged=${s.untagged}`
  );

  if (samples.length > 0) {
    console.log("\nSample province-tagged chunks:");
    for (const sm of samples) {
      console.log(`  [${sm.province} | ${sm.subTopic}] ${sm.snippet}...`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — no writes performed.");
    await client.end();
    return;
  }

  console.log(
    `\nApplying province tag to ${ids.length} chunks in batches of ${BATCH}...`
  );
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const bIds = ids.slice(i, i + BATCH);
    const bProv = provinces.slice(i, i + BATCH);
    const res = await client.query(
      `UPDATE public.kb_chunks AS k
          SET metadata = COALESCE(k.metadata, '{}'::jsonb)
                || jsonb_build_object('province', s.province)
         FROM unnest($1::uuid[], $2::text[]) AS s(id, province)
        WHERE k.id = s.id`,
      [bIds, bProv]
    );
    updated += res.rowCount ?? 0;
    console.log(`  updated ${updated}/${ids.length}`);
  }

  // VERIFY from the live DB after writing.
  const verify = await client.query<{ province: string; n: string }>(
    `SELECT COALESCE(metadata->>'province', '(none)') AS province,
            COUNT(*)::text AS n
       FROM public.kb_chunks
      WHERE subject_id = $1
      GROUP BY 1 ORDER BY n DESC`,
    [SUBJECT_ARG]
  );
  console.log("\nVERIFY — live province counts after update:");
  for (const v of verify.rows) console.log(`  ${v.province}: ${v.n}`);

  // Invariant: sub_topic tagging must be untouched by this script.
  const verifySubTopic = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.kb_chunks
      WHERE subject_id = $1 AND metadata ? 'sub_topic'`,
    [SUBJECT_ARG]
  );
  console.log(
    `\nVERIFY — chunks still carrying sub_topic (must be unchanged): ${
      verifySubTopic.rows[0]?.n ?? "?"
    }`
  );

  await client.end();
  console.log("\nProvince tagging complete.");
}

main().catch((err) => {
  console.error(
    "Province tagging failed:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
