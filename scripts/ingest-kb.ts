import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractText } from "unpdf";
import { loadEnvFile } from "./lib/load-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { embedTexts } from "@/lib/ai/embeddings";
import { assertSubjectId } from "@/lib/subjects";
import { createSubTopicTagger, type SubTopicTagger } from "./lib/subtopic-tagger";

loadEnvFile();

const KB_DIR = path.resolve(process.cwd(), "knowledge-base-source");
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const FORCE_RUN = process.argv.includes("--force");

// Batch size for embedding requests. Gemini embedContent supports up to 100
// contents per call. On the free tier the per-minute quota is tight, so we
// send one max-size batch and then wait for the quota window to roll over.
const EMBED_BATCH_SIZE = 100;

// Sliding-window chunking parameters.
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

const KB_CATEGORIES = [
  "marking_scheme",
  "examiner_report",
  "past_paper",
  "notes",
  "syllabus",
] as const;
type KbCategory = (typeof KB_CATEGORIES)[number];

const SESSION_MAP: Record<string, string> = {
  s: "May/June",
  w: "Oct/Nov",
  m: "March",
};

const TYPE_TO_CATEGORY: Record<
  string,
  { category: KbCategory; subcategory?: string }
> = {
  qp: { category: "past_paper" },
  ms: { category: "marking_scheme" },
  er: { category: "examiner_report" },
  in: { category: "past_paper", subcategory: "insert" },
};

const SUBJECT_BY_FOLDER: Record<string, { subject_id: string; code: string }> = {
  islamiyat: { subject_id: "islamiyat", code: "2058" },
  "pak-studies": { subject_id: "pak-studies", code: "2059" },
  urdu: { subject_id: "urdu", code: "3248" },
};

interface ParsedFile {
  filePath: string;
  subject_id: string;
  code: string;
  category: KbCategory;
  paper_code?: string;
  year?: number;
  session?: string;
  paper?: string;
  subcategory?: string;
  title: string;
}

interface ChunkRow {
  document_id: string;
  subject_id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
}

function toYear(yy: string): number {
  const n = parseInt(yy, 10);
  // Files run 20-26 in the supplied KB; assume 2000+ for 00-99.
  return n >= 50 ? 1900 + n : 2000 + n;
}

function sessionName(code: string): string {
  return SESSION_MAP[code.toLowerCase()] ?? code.toUpperCase();
}

function parseFilename(filePath: string): ParsedFile | null {
  const relative = path.relative(KB_DIR, filePath);
  const parts = relative.split(path.sep);
  const subjectFolder = parts[0]?.toLowerCase();
  const subject = SUBJECT_BY_FOLDER[subjectFolder];
  if (!subject) {
    console.warn(`Unknown subject folder "${subjectFolder}" for ${relative}`);
    return null;
  }

  const basename = path.basename(filePath);
  const ext = path.extname(basename).toLowerCase();
  const stem = basename.slice(0, -ext.length);

  // Standard CAIE filename: 2058_s20_qp_11 or 2059_w22_er
  const standardMatch = stem.match(
    /^(\d{4})_([swm])(\d{2})_(qp|ms|er|in)(?:_(\d{1,2}))?$/i
  );

  if (standardMatch) {
    const [, code, sessionCode, yy, type, paper] = standardMatch;
    const mapped = TYPE_TO_CATEGORY[type.toLowerCase()];
    const year = toYear(yy);
    const paperCode = paper ? `${code}/${paper}` : undefined;
    const titleParts = [
      subject.subject_id,
      code,
      sessionName(sessionCode),
      year,
      type.toUpperCase(),
      paper ?? "",
    ].filter(Boolean);
    return {
      filePath,
      subject_id: subject.subject_id,
      code: code!,
      category: mapped.category,
      paper_code: paperCode,
      year,
      session: sessionName(sessionCode),
      paper,
      subcategory: mapped.subcategory,
      title: titleParts.join(" "),
    };
  }

  // Syllabus filename: 635787-2024-2025-syllabus
  const syllabusMatch = stem.match(/^(\d{5,6})-([\d-]+)-syllabus$/i);
  if (syllabusMatch) {
    const [, syllabusId, yearRange] = syllabusMatch;
    return {
      filePath,
      subject_id: subject.subject_id,
      code: subject.code,
      category: "syllabus",
      year: undefined,
      session: undefined,
      title: `${subject.subject_id} ${subject.code} Syllabus ${yearRange} (${syllabusId})`,
    };
  }

  console.warn(`Could not parse filename: ${basename}`);
  return null;
}

async function findSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSourceFiles(fullPath)));
    } else if (entry.isFile() && /\.(pdf|md)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") {
    return readFile(filePath, "utf8");
  }
  if (ext === ".pdf") {
    const buffer = await readFile(filePath);
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    return text;
  }
  return "";
}

interface GeminiError {
  error?: { code?: number; message?: string; details?: Array<{ [key: string]: unknown }> };
}

function isQuotaError(err: unknown): boolean {
  const gErr = err as GeminiError | undefined;
  const code = gErr?.error?.code;
  const msg = gErr?.error?.message ?? "";
  if (code === 429) return true;
  return /quota|rate limit|resource exhausted|too many requests/i.test(msg);
}

function extractRetryDelay(err: unknown): number | null {
  const gErr = err as GeminiError | undefined;
  const details = gErr?.error?.details ?? [];
  for (const d of details) {
    if (d && typeof d === "object" && d["@type"] === "type.googleapis.com/google.rpc.RetryInfo") {
      const delay = d.retryDelay;
      if (typeof delay === "string") {
        const match = delay.match(/^(\d+)s$/);
        if (match) return parseInt(match[1], 10) * 1000;
      }
    }
  }
  const msg = gErr?.error?.message ?? "";
  const match = msg.match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  return null;
}

async function embedWithRetry(texts: string[], retries = 6): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await embedTexts(texts);
    } catch (err) {
      lastErr = err;
      const retryDelay = extractRetryDelay(err);
      let delay: number;
      if (retryDelay) {
        delay = retryDelay;
      } else if (isQuotaError(err)) {
        // Gemini free-tier quota resets per minute; back off a full window
        // plus a small jitter per attempt.
        delay = 60000 + attempt * 5000;
      } else {
        delay = Math.min(1000 * 2 ** attempt, 32000);
      }
      console.warn(`  -> embedding attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= size) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start += size - overlap;
  }
  return chunks;
}

async function findExistingDocument(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  meta: ParsedFile
): Promise<string | null> {
  let query = supabase
    .from("kb_documents")
    .select("id")
    .eq("subject_id", meta.subject_id)
    .eq("category", meta.category)
    .eq("title", meta.title);

  if (meta.year !== undefined) {
    query = query.eq("year", meta.year);
  } else {
    query = query.is("year", null);
  }

  if (meta.session) {
    query = query.eq("session", meta.session);
  } else {
    query = query.is("session", null);
  }

  if (meta.paper_code) {
    query = query.eq("paper_code", meta.paper_code);
  } else {
    query = query.is("paper_code", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error(`  -> failed to look up existing document:`, error.message);
    return null;
  }
  return data?.id ?? null;
}

async function getChunkCount(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  documentId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("kb_chunks")
    .select("*", { count: "exact", head: true })
    .eq("document_id", documentId);
  if (error) {
    console.error(`  -> failed to check existing chunks:`, error.message);
    return Number.POSITIVE_INFINITY;
  }
  return count ?? 0;
}

async function processFiles(files: string[]) {
  const supabase = createSupabaseAdminClient();

  const { count: docCount, error: docCountErr } = await supabase
    .from("kb_documents")
    .select("*", { count: "exact", head: true });
  const { count: chunkCount, error: chunkCountErr } = await supabase
    .from("kb_chunks")
    .select("*", { count: "exact", head: true });

  if (docCountErr || chunkCountErr) {
    console.error("Failed to check existing KB data:", docCountErr?.message ?? chunkCountErr?.message);
    process.exit(1);
  }

  if ((docCount ?? 0) > 0 || (chunkCount ?? 0) > 0) {
    if (FORCE_RUN) {
      console.warn(
        `FORCE RUN: ingesting on top of ${docCount} documents and ${chunkCount} chunks. Documents are upserted by natural key; already-chunked documents will be skipped unless --force is also used to clear tables.`
      );
    } else {
      console.warn(
        `Existing KB data found (${docCount} documents, ${chunkCount} chunks). Resuming: skipping documents that already have chunks and reusing existing kb_document rows.`
      );
    }
  }

  const parsedFiles = files
    .map(parseFilename)
    .filter((p): p is ParsedFile => p !== null);

  console.log(`Found ${parsedFiles.length} parseable source files out of ${files.length} total.`);

  let documentsCreated = 0;
  let documentsResumed = 0;
  let documentsSkipped = 0;
  let chunksInserted = 0;

  // sub_topic tagging — one lazily-built DETERMINISTIC tagger per subject.
  // Tagging is exact keyword matching over chunk content + filename (no
  // embeddings, no API calls). Rules live in scripts/lib/subtopic-tagger.ts.
  const taggers = new Map<string, SubTopicTagger | null>();
  function getTagger(
    subjectId: string,
    subjectCode: string
  ): SubTopicTagger | null {
    const cached = taggers.get(subjectId);
    if (cached !== undefined) return cached;
    const tagger = createSubTopicTagger(assertSubjectId(subjectId), subjectCode);
    taggers.set(subjectId, tagger);
    return tagger;
  }

  for (let i = 0; i < parsedFiles.length; i++) {
    const meta = parsedFiles[i];
    console.log(`[${i + 1}/${parsedFiles.length}] ${path.basename(meta.filePath)}`);

    let documentId = await findExistingDocument(supabase, meta);

    if (documentId) {
      console.log(`  -> existing kb_document found, resuming`);
      documentsResumed++;
    } else if (DRY_RUN) {
      console.log(`  -> DRY RUN: would create kb_document`);
      documentsCreated++;
      continue;
    } else {
      const { data: doc, error } = await supabase
        .from("kb_documents")
        .insert({
          subject_id: meta.subject_id,
          category: meta.category,
          paper_code: meta.paper_code,
          year: meta.year,
          session: meta.session,
          title: meta.title,
        })
        .select("id")
        .single();

      if (error || !doc) {
        console.error(`  -> failed to insert kb_document:`, error?.message);
        continue;
      }

      documentId = doc.id;
      documentsCreated++;
    }

    if (!documentId) {
      continue;
    }

    const existingChunkCount = await getChunkCount(supabase, documentId);
    if (existingChunkCount > 0) {
      console.log(`  -> ${existingChunkCount} chunks already ingested, skipping`);
      documentsSkipped++;
      continue;
    }

    const text = await extractTextFromFile(meta.filePath);
    if (!text.trim()) {
      console.log(`  -> no extractable text, skipping`);
      continue;
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) continue;

    if (DRY_RUN) {
      console.log(
        `  -> DRY RUN: ${chunks.length} chunks | category=${meta.category} paper_code=${meta.paper_code} year=${meta.year} session=${meta.session}`
      );
      continue;
    }

    console.log(`  -> embedding and inserting ${chunks.length} chunks...`);

    const tagger = getTagger(meta.subject_id, meta.code);
    const sourceFilename = path.basename(meta.filePath);

    for (let j = 0; j < chunks.length; j += EMBED_BATCH_SIZE) {
      const batchContents = chunks.slice(j, j + EMBED_BATCH_SIZE);
      const embeddings = await embedWithRetry(batchContents);

      const rows: ChunkRow[] = batchContents.map((content, k) => {
        // Deterministic keyword match over content + filename; else
        // `general<code>`. See scripts/lib/subtopic-tagger.ts.
        const subTopic = tagger
          ? tagger.tagChunk(content, sourceFilename)
          : `general${meta.code}`;
        return {
          document_id: documentId,
          subject_id: meta.subject_id,
          content,
          metadata: {
            code: meta.code,
            subject_code: meta.code,
            sub_topic: subTopic,
            paper_code: meta.paper_code,
            year: meta.year,
            session: meta.session,
            paper: meta.paper,
            subcategory: meta.subcategory,
            source_filename: sourceFilename,
            category: meta.category,
          },
          embedding: embeddings[k],
        };
      });

      const { error } = await supabase.from("kb_chunks").insert(rows);
      if (error) {
        console.error(
          `  -> failed inserting chunks ${j + 1}-${j + batchContents.length}:`,
          error.message
        );
        throw error;
      }

      chunksInserted += rows.length;
      console.log(`  -> inserted ${chunksInserted}/${chunks.length + chunksInserted - rows.length} chunks for this document`);

      // Pace requests to stay within Gemini free-tier rate limit.
      // The free tier appears to meter embed_content at 100 units/minute,
      // so wait ~60s between max-size batches.
      if (j + EMBED_BATCH_SIZE < chunks.length) {
        console.log("  -> waiting 60s for quota window...");
        await new Promise((r) => setTimeout(r, 60000));
      }
    }
  }

  console.log("\nsub_topic tagging distribution (deterministic keywords):");
  for (const [subjectId, tagger] of taggers) {
    if (!tagger) {
      console.log(`  ${subjectId}: no subject code (all chunks general)`);
      continue;
    }
    const s = tagger.stats;
    console.log(
      `  ${subjectId} (code ${tagger.subjectCode}, ${tagger.ruleCount} keyword rules): ` +
        `keyword=${s.keyword} ambiguous=${s.ambiguous} general=${s.general}`
    );
  }

  console.log("\nIngestion summary:");
  console.log(`  Documents created: ${documentsCreated}`);
  console.log(`  Documents reused (resume): ${documentsResumed}`);
  console.log(`  Documents skipped (already chunked): ${documentsSkipped}`);
  console.log(`  New chunks inserted: ${chunksInserted}`);
  console.log("Ingestion complete.");
}

async function main() {
  const files = await findSourceFiles(KB_DIR);
  console.log(`Scanning ${KB_DIR}...`);
  await processFiles(files);
}

main().catch((err) => {
  console.error("Ingestion failed:", err?.message ?? err);
  process.exit(1);
});
