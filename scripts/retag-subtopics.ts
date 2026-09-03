/**
 * scripts/retag-subtopics.ts
 * -----------------------------------------------------------------------------
 * DB CLEANUP — deterministically re-assign `metadata.sub_topic` (+ ensure
 * `metadata.subject_code`) on every existing kb_chunks row, WITHOUT re-embedding
 * and WITHOUT touching content or vectors.
 *
 * Why: the original ingest predates sub_topic tagging, and the interim
 * embedding-similarity tagger cross-contaminated near-identical events
 * (Badr 624 AD vs Uhud 625 AD). This script re-tags the LIVE rows using the
 * deterministic keyword rules in scripts/lib/subtopic-tagger.ts, so a hard
 * metadata filter (migration 0005 match_sub_topic) can then keep Uhud chunks
 * out of Badr queries at the database layer.
 *
 * Safe by construction:
 *   - Read-only unless run WITHOUT --dry-run.
 *   - Update is a JSONB merge (`metadata || jsonb_build_object(...)`): existing
 *     keys are preserved; only sub_topic / subject_code are set.
 *   - Reports BEFORE -> AFTER distribution + isolation invariants, then
 *     re-queries the live DB to VERIFY the written counts.
 *
 * Usage:
 *   npx tsx scripts/retag-subtopics.ts --dry-run            # report only
 *   npx tsx scripts/retag-subtopics.ts                      # apply to all
 *   npx tsx scripts/retag-subtopics.ts --subject=islamiyat  # one subject
 *   npx tsx scripts/retag-subtopics.ts --batch=2000         # update batch size
 */
import { Client } from "pg";
import { loadEnvFile } from "./lib/load-env";
import { getSubject, isSubjectId } from "@/lib/subjects";
import { getEffectiveTaxonomy } from "@/lib/kb/subtopics";
import { createSubTopicTagger, type SubTopicTagger } from "./lib/subtopic-tagger";

loadEnvFile();

const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

function flagValue(prefix: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const SUBJECT_ARG = flagValue("--subject=");
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

type Distribution = Map<string, Map<string, number>>;

function bump(dist: Distribution, subject: string, tag: string): void {
  const inner = dist.get(subject) ?? new Map<string, number>();
  inner.set(tag, (inner.get(tag) ?? 0) + 1);
  dist.set(subject, inner);
}

function printDistribution(label: string, dist: Distribution): void {
  console.log(`\n${label} sub_topic distribution:`);
  for (const [subject, tags] of [...dist.entries()].sort()) {
    const total = [...tags.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${subject} (${total} chunks):`);
    for (const [tag, n] of [...tags.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${tag}: ${n}`);
    }
  }
}

/**
 * Strict-isolation readiness check: cross-reference the projected tag counts
 * against each subject's product-defined taxonomy. Under migration 0006 the
 * RPC keeps ONLY chunks whose metadata.sub_topic EXACTLY equals the requested
 * slug, so any taxonomy sub-topic with 0 tagged chunks would return
 * "insufficient context". Report missing + thin (<3) topics so weak keyword
 * rules can be tuned before going live.
 */
function printCoverage(dist: Distribution): void {
  console.log(
    "\nSub-topic coverage vs product taxonomy (strict-isolation readiness):"
  );
  for (const [subject, tags] of [...dist.entries()].sort()) {
    if (!isSubjectId(subject)) continue;
    const taxonomy = getEffectiveTaxonomy(subject);
    if (!taxonomy) continue;
    const slugs = [
      ...new Set(taxonomy.papers.flatMap((p) => p.topics.map((t) => t.id))),
    ];
    const count = (s: string): number => tags.get(s) ?? 0;
    const covered = slugs.filter((s) => count(s) > 0);
    const missing = slugs.filter((s) => count(s) === 0);
    const thin = covered
      .filter((s) => count(s) < 3)
      .sort((a, b) => count(a) - count(b));
    console.log(
      `  ${subject}: ${covered.length}/${slugs.length} taxonomy sub-topics have chunks`
    );
    if (missing.length > 0) {
      console.log(
        `    MISSING (0 chunks -> insufficient-context under strict isolation):`
      );
      for (const m of missing) console.log(`      - ${m}`);
    }
    if (thin.length > 0) {
      console.log(
        `    THIN (<3 chunks): ${thin.map((s) => `${s}=${count(s)}`).join(", ")}`
      );
    }
  }
}

async function main(): Promise<void> {
  const connectionString =
    process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing SUPABASE_DB_URL (or DATABASE_URL) in .env.local");
    process.exit(1);
  }
  if (SUBJECT_ARG && !isSubjectId(SUBJECT_ARG)) {
    console.error(`Unknown subject: ${SUBJECT_ARG}`);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  console.log("Connected to Supabase Postgres.");

  const where = SUBJECT_ARG ? "WHERE subject_id = $1" : "";
  const whereParams = SUBJECT_ARG ? [SUBJECT_ARG] : [];

  const { rows } = await client.query<ChunkRow>(
    `SELECT id, subject_id, content, metadata
       FROM public.kb_chunks ${where}
      ORDER BY subject_id, id`,
    whereParams
  );
  console.log(
    `Fetched ${rows.length} chunks${SUBJECT_ARG ? ` for subject=${SUBJECT_ARG}` : ""}.`
  );
  if (rows.length === 0) {
    await client.end();
    return;
  }

  // Deterministic taggers, one per subject (cached).
  const taggers = new Map<string, SubTopicTagger | null>();
  const getTagger = (subjectId: string): SubTopicTagger | null => {
    if (taggers.has(subjectId)) return taggers.get(subjectId) ?? null;
    const tagger = isSubjectId(subjectId)
      ? createSubTopicTagger(subjectId, getSubject(subjectId)?.code ?? "")
      : null;
    taggers.set(subjectId, tagger);
    return tagger;
  };

  const ids: string[] = [];
  const newTags: string[] = [];
  const newCodes: string[] = [];
  const before: Distribution = new Map();
  const after: Distribution = new Map();
  const samples: Array<{ after: string; before: string; snippet: string }> = [];

  let badrTotal = 0;
  let uhudTotal = 0;
  let badrContainingUhud = 0; // invariant: MUST stay 0 (Uhud vetoes Badr)
  let badrWithAnchor = 0; // badr-tagged AND contains the word 'badr'
  let uhudWithAnchor = 0; // uhud-tagged AND contains the word 'uhud'
  let uhudContainingBadr = 0; // uhud-tagged AND contains 'badr' (comparison/secondary)

  for (const row of rows) {
    const md = row.metadata ?? {};
    const content = row.content ?? "";
    const filename = str(md.source_filename) || str(md.filename);
    const beforeTag = str(md.sub_topic) || "(untagged)";
    const code = isSubjectId(row.subject_id)
      ? getSubject(row.subject_id)?.code ?? ""
      : str(md.subject_code) || str(md.code);
    const tagger = getTagger(row.subject_id);
    const afterTag = tagger ? tagger.tagChunk(content, filename) : `general${code}`;

    bump(before, row.subject_id, beforeTag);
    bump(after, row.subject_id, afterTag);

    if (afterTag === "battle_of_badr_624ad") {
      badrTotal++;
      if (/\buhud\b/i.test(content)) badrContainingUhud++;
      if (/\bbadr\b/i.test(content)) badrWithAnchor++;
    } else if (afterTag === "battle_of_uhud_625ad") {
      uhudTotal++;
      if (/\buhud\b/i.test(content)) uhudWithAnchor++;
      if (/\bbadr\b/i.test(content)) uhudContainingBadr++;
    }

    if (
      samples.length < 6 &&
      (afterTag === "battle_of_badr_624ad" || afterTag === "battle_of_uhud_625ad")
    ) {
      samples.push({
        after: afterTag,
        before: beforeTag,
        snippet: content.slice(0, 140).replace(/\s+/g, " "),
      });
    }

    ids.push(row.id);
    newTags.push(afterTag);
    newCodes.push(code);
  }

  printDistribution("BEFORE", before);
  printDistribution("AFTER (projected)", after);
  printCoverage(after);

  console.log("\nIsolation metrics (islamiyat 2058):");
  console.log(
    `  battle_of_badr_624ad chunks: ${badrTotal} (contain the word 'badr': ${badrWithAnchor}; secondary-keyword-only: ${badrTotal - badrWithAnchor})`
  );
  console.log(
    `  battle_of_uhud_625ad chunks: ${uhudTotal} (contain the word 'uhud': ${uhudWithAnchor}; secondary-keyword-only: ${uhudTotal - uhudWithAnchor})`
  );
  console.log(
    `  Badr-tagged chunks containing the word 'uhud' (MUST be 0): ${badrContainingUhud}`
  );
  console.log(
    `  Uhud-tagged chunks also containing 'badr' (comparison / secondary-keyword): ${uhudContainingBadr}`
  );

  console.log("\nTagger stats:");
  for (const [subject, t] of taggers) {
    if (!t) {
      console.log(`  ${subject}: no tagger (unknown subject code)`);
      continue;
    }
    console.log(
      `  ${subject} (code ${t.subjectCode}, ${t.ruleCount} keyword rules): ` +
        `keyword=${t.stats.keyword} ambiguous=${t.stats.ambiguous} general=${t.stats.general}`
    );
  }

  if (samples.length > 0) {
    console.log("\nSample tagged chunks:");
    for (const s of samples) {
      console.log(`  [${s.before} -> ${s.after}] ${s.snippet}...`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — no writes performed.");
    await client.end();
    return;
  }

  console.log(`\nApplying re-tag to ${ids.length} chunks in batches of ${BATCH}...`);
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const bIds = ids.slice(i, i + BATCH);
    const bTags = newTags.slice(i, i + BATCH);
    const bCodes = newCodes.slice(i, i + BATCH);
    const res = await client.query(
      `UPDATE public.kb_chunks AS k
          SET metadata = COALESCE(k.metadata, '{}'::jsonb)
                || jsonb_build_object('sub_topic', s.sub_topic, 'subject_code', s.subject_code)
         FROM unnest($1::uuid[], $2::text[], $3::text[]) AS s(id, sub_topic, subject_code)
        WHERE k.id = s.id`,
      [bIds, bTags, bCodes]
    );
    updated += res.rowCount ?? 0;
    console.log(`  updated ${updated}/${ids.length}`);
  }

  // VERIFY from the live DB after writing.
  const verify = await client.query<{ sub_topic: string; n: string }>(
    `SELECT COALESCE(metadata->>'sub_topic', '(untagged)') AS sub_topic,
            COUNT(*)::text AS n
       FROM public.kb_chunks ${where}
      GROUP BY 1 ORDER BY n DESC`,
    whereParams
  );
  console.log("\nVERIFY — live sub_topic counts after update:");
  for (const v of verify.rows) console.log(`  ${v.sub_topic}: ${v.n}`);

  const verifyIso = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.kb_chunks
      WHERE metadata->>'sub_topic' = 'battle_of_badr_624ad'
        AND content ~* '\\yuhud\\y'`
  );
  console.log(
    `\nVERIFY — Badr-tagged chunks containing the word 'uhud' (MUST be 0): ${
      verifyIso.rows[0]?.n ?? "?"
    }`
  );

  await client.end();
  console.log("\nRe-tag complete.");
}

main().catch((err) => {
  console.error("Re-tag failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
