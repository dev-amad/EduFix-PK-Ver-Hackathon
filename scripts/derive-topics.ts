/**
 * Task 4.1 prerequisite: derive the Topic Selector taxonomy from the CAIE
 * syllabus PDFs in knowledge-base-source. Topics are NOT authored by hand —
 * they are parsed out of the official syllabus text so no mock CAIE content
 * is introduced (rules.md §1).
 *
 * Output: src/lib/kb/topics.json  (committed, regenerable via this script)
 * Usage:  npx tsx scripts/derive-topics.ts
 */
import { getDocumentProxy, extractText } from "unpdf";
import fs from "fs";
import path from "path";

interface TopicEntry {
  id: string;
  title: string;
}

interface PaperEntry {
  id: string;
  title: string;
  topics: TopicEntry[];
}

interface SubjectTaxonomy {
  syllabus_file: string;
  papers: PaperEntry[];
}

const SYLLABUS_FILES: Record<string, string> = {
  "pak-studies": "knowledge-base-source/pak-studies/pst 2059/697282-2026-syllabus.pdf",
  islamiyat: "knowledge-base-source/islamiyat/isl 2058/635787-2024-2025-syllabus.pdf",
  urdu: "knowledge-base-source/urdu/urdu 3248/634455-2024-2026-syllabus.pdf",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function extractLines(relPath: string): Promise<string[]> {
  const full = path.join(process.cwd(), relPath);
  const buf = fs.readFileSync(full);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await extractText(pdf, { mergePages: true });
  const text = (result as { text?: string | string[] }).text;
  const raw = Array.isArray(text) ? text.join("\n") : String(text ?? "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/\.{6,}/.test(line)) return false; // TOC entries with dot leaders
      if (/^Cambridge O Level/.test(line)) return false; // running footer
      if (/www\.cambridgeinternational/.test(line)) return false;
      if (/Back to contents page/.test(line)) return false;
      if (/^\d+$/.test(line)) return false; // bare page numbers
      return true;
    });
}

function indexOfAfter(lines: string[], predicate: (line: string) => boolean, after: number): number {
  for (let i = after; i < lines.length; i++) {
    if (predicate(lines[i])) return i;
  }
  return -1;
}

/** Captures numbered heading lines ("1. Title") between start and end, joining lowercase continuation lines. */
function numberedHeadings(lines: string[], start: number, end: number): string[] {
  const headings: string[] = [];
  for (let i = start; i < end && i < lines.length; i++) {
    const match = lines[i].match(/^(\d+)\.\s+(.+)$/);
    if (!match) continue;
    let title = match[2].trim();
    // Wrapped heading continuation: next line starts lowercase (mid-phrase).
    let j = i + 1;
    while (j < end && /^[a-z]/.test(lines[j]) && !/^[a-z]\)/.test(lines[j])) {
      title += ` ${lines[j]}`;
      j++;
    }
    headings.push(title.replace(/\.$/, "").trim());
  }
  return headings;
}

function toTopics(paperId: string, titles: string[]): TopicEntry[] {
  return titles.map((title, index) => ({
    id: `${paperId}-${index + 1}-${slugify(title)}`.slice(0, 80),
    title,
  }));
}

function parsePakStudies(lines: string[]): PaperEntry[] {
  const contentStart = indexOfAfter(lines, (l) => /^6\.\s+Syllabus content/.test(l), 0);
  const p1Head = indexOfAfter(lines, (l) => /^Paper 1 The history and culture of Pakistan/.test(l), contentStart);
  const p2Head = indexOfAfter(lines, (l) => /^Paper 2 The environment of Pakistan/.test(l), p1Head);
  const end = indexOfAfter(lines, (l) => /^7\.\s+Glossary of terms for Paper 2/.test(l), p2Head);
  if (contentStart < 0 || p1Head < 0 || p2Head < 0 || end < 0) {
    throw new Error(`pak-studies anchors not found: ${contentStart}, ${p1Head}, ${p2Head}, ${end}`);
  }
  const p1Titles = numberedHeadings(lines, p1Head, p2Head);
  const p2Titles = numberedHeadings(lines, p2Head, end);
  return [
    { id: "1", title: "The history and culture of Pakistan", topics: toTopics("1", p1Titles) },
    { id: "2", title: "The environment of Pakistan", topics: toTopics("2", p2Titles) },
  ];
}

function parseIslamiyat(lines: string[]): PaperEntry[] {
  const contentStart = indexOfAfter(lines, (l) => /^5\.\s+Syllabus content/.test(l), 0);
  const p1Head = indexOfAfter(lines, (l) => /^5\.1\s+Paper 1/.test(l), contentStart);
  const p2Head = indexOfAfter(lines, (l) => /^5\.2\s+Paper 2/.test(l), p1Head);
  const end = indexOfAfter(lines, (l) => /^6\.\s+Appendix 1/.test(l), p2Head);
  if (contentStart < 0 || p1Head < 0 || p2Head < 0 || end < 0) {
    throw new Error(`islamiyat anchors not found: ${contentStart}, ${p1Head}, ${p2Head}, ${end}`);
  }
  const p1Titles = numberedHeadings(lines, p1Head, p2Head);
  const p2Titles = numberedHeadings(lines, p2Head, end);
  return [
    { id: "1", title: "Paper 1", topics: toTopics("1", p1Titles) },
    { id: "2", title: "Paper 2", topics: toTopics("2", p2Titles) },
  ];
}

function parseUrdu(lines: string[]): PaperEntry[] {
  // Urdu 3248 is a language syllabus: papers are skills-based and source texts
  // are drawn from the syllabus-declared topic areas. Extract that list verbatim.
  const join = lines.join(" ");
  const match = join.match(/These might include, for example,\s+(.+?)\. This list is not exhaustive/);
  if (!match) {
    throw new Error("urdu topic-areas sentence not found");
  }
  const listText = match[1].replace(/, and /g, " and ");
  const parts = listText
    .split(" and ")
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
  return [
    { id: "1", title: "Reading and Writing", topics: toTopics("1", parts) },
    { id: "2", title: "Grammar, Writing and Translation", topics: toTopics("2", parts) },
  ];
}

async function main() {
  const output: Record<string, SubjectTaxonomy> = {};

  const pakLines = await extractLines(SYLLABUS_FILES["pak-studies"]);
  output["pak-studies"] = {
    syllabus_file: path.basename(SYLLABUS_FILES["pak-studies"]),
    papers: parsePakStudies(pakLines),
  };

  const islLines = await extractLines(SYLLABUS_FILES["islamiyat"]);
  output["islamiyat"] = {
    syllabus_file: path.basename(SYLLABUS_FILES["islamiyat"]),
    papers: parseIslamiyat(islLines),
  };

  const urduLines = await extractLines(SYLLABUS_FILES["urdu"]);
  output["urdu"] = {
    syllabus_file: path.basename(SYLLABUS_FILES["urdu"]),
    papers: parseUrdu(urduLines),
  };

  const outPath = path.join(process.cwd(), "src", "lib", "kb", "topics.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  for (const [subject, taxonomy] of Object.entries(output)) {
    console.log(`\n=== ${subject} (${taxonomy.syllabus_file}) ===`);
    for (const paper of taxonomy.papers) {
      console.log(`Paper ${paper.id} — ${paper.title} (${paper.topics.length} topics)`);
      for (const topic of paper.topics) {
        console.log(`  • [${topic.id}] ${topic.title}`);
      }
    }
  }
  console.log(`\nWrote ${outPath}`);
}

main();
