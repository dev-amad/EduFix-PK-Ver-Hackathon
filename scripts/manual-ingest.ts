import { createClient } from '@supabase/supabase-js';
import { pipeline } from '@xenova/transformers';
import { getDocumentProxy, extractText } from 'unpdf';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { createSubTopicTagger, type SubTopicTagger } from './lib/subtopic-tagger';
import { createProvinceTagger } from './lib/province-tagger';
import { getSubject, assertSubjectId } from '@/lib/subjects';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const SOURCE_DIR = path.join(process.cwd(), 'knowledge-base-source');

const SUBJECT_MAP: Record<string, string> = {
  '2058': 'islamiyat',
  '2059': 'pak-studies',
  '0448': 'pak-studies',
  '3248': 'urdu'
};

function parseCambridgeFilename(filePath: string) {
  const filename = path.basename(filePath);
  const lowerName = filename.toLowerCase();

  const regex = /^(\d{4})_([a-z])(\d{2})_([a-z]{2})(?:_(\d+))?\.pdf$/i;
  const match = lowerName.match(regex);

  let subjectId = 'pak-studies';
  let session = 'unknown';
  let year = 'unknown';
  let category = 'notes';
  let paperCode = 'unknown';

  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('islamiyat') || lowerPath.includes('2058')) subjectId = 'islamiyat';
  else if (lowerPath.includes('urdu') || lowerPath.includes('3248')) subjectId = 'urdu';

  if (match) {
    const [, code, sessChar, yrDigits, catCode, variant] = match;

    if (SUBJECT_MAP[code]) subjectId = SUBJECT_MAP[code];

    if (sessChar === 's') session = 'May/June';
    else if (sessChar === 'w') session = 'Oct/Nov';
    else if (sessChar === 'm') session = 'March';
    else if (sessChar === 'y') session = 'Yearly Specimen';

    year = `20${yrDigits}`;

    switch (catCode) {
      case 'ms': category = 'marking_scheme'; break;
      case 'qp': category = 'past_paper'; break;
      case 'in': category = 'insert'; break;
      case 'er': category = 'examiner_report'; break;
      case 'gt': category = 'grade_threshold'; break;
      case 'sy': category = 'syllabus'; break;
      default: category = 'past_paper'; break;
    }

    paperCode = variant || 'unknown';
  } else {
    if (lowerName.includes('_ms_') || lowerName.includes(' ms ')) category = 'marking_scheme';
    else if (lowerName.includes('_qp_') || lowerName.includes(' qp ')) category = 'past_paper';
    else if (lowerName.includes('syllabus')) category = 'syllabus';
  }

  return {
    subject_id: subjectId,
    subject_code: getSubject(subjectId)?.code ?? '',
    category: category,
    session: session,
    year: year,
    paper_code: paperCode,
    filename: filename,
    file_path: filePath
  };
}

function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start += chunkSize - overlap;
  }
  return chunks;
}

function getPdfFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      results = results.concat(getPdfFiles(filePath));
    } else if (file.toLowerCase().endsWith('.pdf')) {
      results.push(filePath);
    }
  });
  return results;
}

async function runManualIngestion() {
  console.log('🚀 Initializing Local Embedding Model (Xenova/all-mpnet-base-v2)...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');

  // sub_topic tagging — one lazily-built DETERMINISTIC tagger per subject.
  // Exact keyword matching over chunk content + filename (no embeddings); rules
  // live in scripts/lib/subtopic-tagger.ts.
  const taggers = new Map<string, SubTopicTagger | null>();
  const getTagger = (subjectId: string): SubTopicTagger | null => {
    const cached = taggers.get(subjectId);
    if (cached !== undefined) return cached;
    const tagger = createSubTopicTagger(
      assertSubjectId(subjectId),
      getSubject(subjectId)?.code ?? ''
    );
    taggers.set(subjectId, tagger);
    return tagger;
  };

  // province tagging (2059 Geography) — one deterministic tagger; its keywords
  // are Pakistan-geography-specific so it is applied to pak-studies chunks only.
  const provinceTagger = createProvinceTagger();

  console.log('🚀 Starting Ingestion Pipeline...\n');
  const pdfFiles = getPdfFiles(SOURCE_DIR);
  console.log(`📁 Found ${pdfFiles.length} PDF files.\n`);

  let totalChunksIngested = 0;
  let skippedFiles = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const metadata = parseCambridgeFilename(filePath);

    const { data: existing } = await supabase
      .from('kb_chunks')
      .select('id')
      .eq('metadata->>filename', metadata.filename)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`⏩ [${i + 1}/${pdfFiles.length}] Skipping: ${metadata.filename} (Already in DB)`);
      continue;
    }

    console.log(`🚀 [${i + 1}/${pdfFiles.length}] Processing: ${metadata.filename} [${metadata.subject_id} | ${metadata.category}]`);

    try {
      const buffer = fs.readFileSync(filePath);
      if (buffer.length < 100) {
        skippedFiles++;
        continue;
      }

      const pdf = await getDocumentProxy(new Uint8Array(buffer)).catch((err: any) => {
        throw new Error('PDF Parsing failed: ' + (err.message || 'Unknown error'));
      });

      const textResult = await extractText(pdf, { mergePages: true }).catch((err: any) => {
        throw new Error('Text extraction failed: ' + (err.message || 'Unknown error'));
      });

      const extractedText = textResult && textResult.text ? textResult.text : '';
      if (!extractedText || extractedText.trim().length === 0) {
        skippedFiles++;
        continue;
      }

      const chunks = chunkText(extractedText);
      const tagger = getTagger(metadata.subject_id);

      for (const chunk of chunks) {
        const output = await extractor(chunk, { pooling: 'mean', normalize: true });
        const vector = Array.from(output.data);

        // Deterministic keyword match over content + filename -> `general<code>`.
        const subTopic = tagger
          ? tagger.tagChunk(chunk, metadata.filename)
          : `general${metadata.subject_code}`;

        // Deterministic province stamp for Pakistan Studies (2059 Geography);
        // omitted (no key) when the chunk resolves to no single province.
        const province =
          metadata.subject_id === 'pak-studies'
            ? provinceTagger.tagChunk(chunk, metadata.filename)
            : undefined;

        const { error } = await supabase.from('kb_chunks').insert({
          subject_id: metadata.subject_id,
          content: chunk,
          metadata: { ...metadata, sub_topic: subTopic, ...(province ? { province } : {}) },
          embedding: vector
        });

        if (!error) {
          totalChunksIngested++;
        } else {
          console.error(`  ⚠️ Supabase Insert Error:`, error.message);
        }
      }
    } catch (err: any) {
      console.error(`❌ Skipped [${metadata.filename}]:`, err.message || err);
      skippedFiles++;
    }
  }

  console.log('\n🏷️  sub_topic tagging distribution (deterministic keywords):');
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

  const ps = provinceTagger.stats;
  console.log('\n🗺️  province tagging distribution (pak-studies 2059 Geography):');
  console.log(
    `  balochistan=${ps.balochistan} sindh=${ps.sindh} punjab=${ps.punjab} kpk_north=${ps.kpk_north} ` +
      `ambiguous=${ps.ambiguous} untagged=${ps.untagged}`
  );

  console.log(`\n✅ Ingestion Complete! Stored ${totalChunksIngested} chunks with structured Cambridge metadata.`);
}

runManualIngestion();