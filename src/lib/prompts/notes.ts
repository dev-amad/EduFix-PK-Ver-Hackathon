/**
 * Notes module prompt builders — CAIE O-Level Note Generator Engine.
 *
 * These assemble the system + user prompts sent to the Groq LLM for the
 * always-on, retrieval-grounded study-notes generator. The output is long-form,
 * exam-focused MARKDOWN organised around the two CAIE Assessment Objectives
 * (AO1 knowledge/recall, AO2 understanding/evaluation) plus examiner-report
 * warnings and sample questions.
 *
 * Grounding rule (rules.md §1): the notes are comprehensive in STRUCTURE and
 * EXPLANATION, but every specific fact (dates, names, verses, mark allocations)
 * must originate from the retrieved context — these prompts never embed authored
 * syllabus content, and the model must not invent details to "fill" a section.
 */

import { getSubject, type SubjectId } from "@/lib/subjects";
import { withSubjectScopeMarkdown } from "@/lib/prompts/guardrails";

/**
 * Total retrieved-context budget (chars) placed in the user prompt.
 *
 * Groq's free-tier 8000 tokens-per-minute (TPM) cap counts a single request's
 * INPUT tokens + the max_tokens OUTPUT reservation TOGETHER, so the budget is
 * subject-aware:
 *   • English subjects (Islamiyat, Pakistan Studies) tokenise at ~4 chars/token,
 *     so ~11k chars of context ≈ 2.75k input tokens; with the ~1.6k-token system
 *     prompt and the 3.1k output reservation that lands ~7.4k tokens — under the
 *     cap — while letting ~8–10 chunks reach the model. This is the dense-context
 *     fix for the old truncation that starved only ~4–5 chunks into the prompt
 *     and capped Pakistan Studies at Level-3 surface detail.
 *   • Urdu tokenises densely (~3 chars/token), so it keeps the 8k-char budget
 *     empirically proven to avoid the 413 "Limit 8000, Requested 8401"
 *     rejection. Chunks are ordered by similarity, so the budget keeps the most
 *     on-topic sources first.
 */
export const MAX_CONTEXT_CHARS = 11_000;
/** Urdu-safe context budget (dense script); see MAX_CONTEXT_CHARS. */
export const MAX_CONTEXT_CHARS_URDU = 8_000;
/**
 * Per-chunk excerpt cap applied before the global budget. Trimmed from 1_800 to
 * 1_200 so ~8–10 chunks fit the English budget (breadth of sources) rather than
 * ~5 — the trade-off chosen for the dense-context fix.
 */
export const MAX_CHUNK_CHARS = 1_200;
/**
 * Upper bound on generated markdown length — also the output-token reservation
 * Groq counts against the TPM cap. Held at 3_100 (down from 3_400) to free input
 * budget for the larger context window while still leaving ample room for the
 * fully-fleshed 5-section prose the note engine now requires.
 */
export const NOTES_MAX_TOKENS = 3_100;
/**
 * Geography (2059/02) output cap — Fix #3 token/output optimisation. Geography
 * notes are DIRECT, DENSE bullets rather than the 5-section textbook prose the
 * other subjects use, so they need a tighter ceiling (2_500 response tokens),
 * which also trims the Groq TPM output reservation. Non-geography keeps 3_100.
 */
export const NOTES_MAX_TOKENS_GEOGRAPHY = 2_500;

/** A single retrieved context chunk, already assigned a stable citation id. */
export interface NotesContextChunk {
  id: string;
  title: string | null;
  category: string | null;
  paperCode: string | null;
  year: number | null;
  session: string | null;
  text: string;
}

export interface BuildNotesSystemPromptArgs {
  subject: SubjectId;
  subjectName: string;
  subjectCode: string;
  /** Authoritative sub-topic display name resolved server-side. */
  subTopicDisplayName: string;
  /**
   * Owning paper/section id of the selected sub-topic ("1" = History,
   * "2" = Geography for Pakistan Studies), resolved server-side and robust to
   * the request's paperCode being "all". Drives the dedicated Geography route.
   */
  paperCode?: string;
}

export interface BuildNotesUserPromptArgs {
  subject: SubjectId;
  paperCode: string;
  /** Paper/section label (e.g. "Paper 1 — History (1906–1947)"), when known. */
  sectionLabel?: string;
  topicLabel: string;
  chunks: NotesContextChunk[];
}

/**
 * Build the Notes system prompt: the CAIE examiner / Senior Subject Lead persona,
 * the shared zero-hallucination guardrails (markdown variant), the AO1/AO2 depth
 * constraints, and the strict markdown output skeleton.
 */
export function buildNotesSystemPrompt(args: BuildNotesSystemPromptArgs): string {
  const { subject, subjectName, subjectCode, subTopicDisplayName, paperCode } = args;

  // Fix #1 — dedicated CAIE Geography (2059/02) route. Paper 2 of Pakistan
  // Studies is GEOGRAPHY, not History, so it must NOT inherit the Level-4
  // Cause/Counter-Factor essay framework (the "prompt bleed" bug). The owning
  // paper is threaded in by the route (robust to paperCode === "all").
  const isPakGeography = subject === "pak-studies" && paperCode === "2";

  const urduAddendum =
    subject === "urdu"
      ? "\n- LANGUAGE: Write the notes in Urdu script where the subject matter is Urdu. Preserve all Urdu-script vocabulary, idioms and quotations (محاورات) verbatim, each followed by a concise English gloss in brackets."
      : "";

  // Faithfulness reinforcement (all subjects): the retrieved chunks are the ONLY
  // permitted source of facts. Restated explicitly because the top-level
  // guardrails alone did not stop the model extrapolating casualties/martyrs.
  const groundingRule = `STRICT GROUNDING RULE (highest priority):
You must rely EXCLUSIVELY on the retrieved text chunks provided in the context. If a fact (e.g. casualties, specific martyrs, causes, dates, names) is not explicitly present in the provided chunks for the requested sub-topic, DO NOT extrapolate, infer, or use outside/parametric knowledge — omit it, or write the insufficient-context sentence required by the guardrails.`;

  // Anti-cross-contamination (2058/01 Islamiyat only): near-identical battles
  // (Badr 624 AD / Uhud 625 AD) were bleeding into each other. These canonical
  // anchors let the model DETECT a mismatch and refuse to transfer details; the
  // retrieved chunks remain the sole source of any figure actually written.
  const eventIsolationRule =
    subject === "islamiyat"
      ? `\n\nEVENT ISOLATION RULE (${subjectCode}/01 Islamiyat — anti-cross-contamination):
Never mix events across historical battles. For ${subjectCode}/01 Islamiyat, double-check every date, casualty number and martyrdom AGAINST THE PROVIDED CHUNKS before writing it. Canonical anchors: Badr = 14 martyrs / 624 AD / 2 AH. Uhud = 70 martyrs / 625 AD / 3 AH. Do NOT transfer details, names or figures between these battles. If the chunks retrieved for "${subTopicDisplayName}" do not explicitly state a figure, do NOT supply it from the other battle or from memory.`
      : "";

  // Fix #2 / spatial-fix — Geography spatial-grounding rule (2059/02 only). Now
  // reconciled with the SPATIAL BOUNDARY MATRIX: directions/distances/coordinates
  // still must come from the chunks, but PROVINCIAL placement is cross-checked
  // against the hardcoded matrix so landforms are never mixed across provinces.
  const geographySpatialRule = isPakGeography
    ? `\n\nGEOGRAPHY SPATIAL-GROUNDING RULE (${subjectCode}/02 — highest priority):
All location facts, desert positions, drainage systems, and canal projects MUST strictly align with the provided chunks. Never guess directions (north/south/east/west), distances, elevations or coordinates the chunks do not state. For the PROVINCIAL placement of a named landform, cross-check it against the SPATIAL BOUNDARY MATRIX below and never assign a feature to a province the matrix does not list it under. Where chunks and matrix agree, state the location; where the chunks are silent, rely on the matrix for province ONLY; where the chunks explicitly contradict the matrix, the CHUNKS win.`
    : "";

  // Fix #2 — Topography key-concept checklist (2059/02): define each landform
  // term the context actually supports; never invent a definition or location.
  const geographyKeyConcepts = isPakGeography
    ? `\n\nGEOGRAPHY KEY-CONCEPT CHECKLIST (${subjectCode}/02 Topography & Landforms):
When the retrieved context concerns topography or landforms, give an explicit one-to-two-line definition of EACH of the following that appears in the chunks — Active Floodplains vs Old Floodplains, Alluvial Fans, Pediments, Cuestas, Hamuns (inland drainage basins / playas), and Dunes (distinguishing longitudinal vs latitudinal). Define a term ONLY where the context supports it; never invent a definition, a location or a direction for a landform the chunks do not mention.`
    : "";

  // Fix #1 — SPATIAL BOUNDARY MATRIX (2059/02): a hardcoded province→landform
  // cross-check, the Geography analogue of the Islamiyat event-isolation anchors.
  // It is REFERENCE data for VERIFYING placement — never a source of authored note
  // content (rules.md §1): the retrieved chunks still supply every written fact,
  // and the matrix list itself must not be reproduced in the output.
  const spatialBoundaryMatrix = isPakGeography
    ? `\n\nSPATIAL BOUNDARY MATRIX (${subjectCode}/02 — non-negotiable provincial cross-check):
Before stating where any landform or feature lies, cross-check it against this authoritative province lookup and NEVER misplace a feature across a provincial boundary:
- BALOCHISTAN: Kharan Desert, Chaghai Hills, Ras Koh, Sulaiman Range, Makran Coast/Range, Quetta Plateau, Gwadar, Ormara, Pasni.
- SINDH: Thar Desert (Tharparkar), Lower Indus Plain, Indus Delta, Kirthar Range, Karachi, Hyderabad, Sukkur.
- PUNJAB: Cholistan Desert, Thal Desert, Potwar Plateau, Salt Range, Upper Indus Plain, Margalla Hills.
- KPK & NORTHERN AREAS: Karakoram, Himalayas, Hindu Kush, Swat, Chitral, Kaghan, Peshawar Valley, Gilgit-Baltistan.
RULE: cross-check EVERY landform against BOTH this matrix AND the context chunks. If a feature is not listed here, do NOT assign it a province unless the chunks explicitly state one. This matrix constrains placement only — it is not note content, so do NOT reproduce the list in the output.`
    : "";

  // Section 5 body — CAIE 2058/01 Paper 1 question format for Islamiyat; the
  // generic two-question form for every other subject. Heading stays identical
  // so the strict output contract is preserved.
  const section5Body =
    subject === "islamiyat"
      ? `Reflect the CAIE ${subjectCode}/01 Paper 1 structure exactly:
* Question 1 is COMPULSORY (passage-based questions); Question 2 is COMPULSORY (Major Topic).
* Major historical events (e.g. the Battles of Badr and Uhud) are examined in SECTION B — Questions 3, 4 or 5 — each as a 10-mark AO1 (recall) part (a) plus a 4-mark AO2 (evaluation) part (b).
* Format every sample question EXACTLY as "Question X(a) [10 marks]" and "Question X(b) [4 marks]" (X = the question number), each followed by bulleted mark-scheme point allocations drawn from the retrieved context.
* Do NOT invent questions, wording or mark allocations that are not grounded in the retrieved question-paper / mark-scheme context.`
      : `* [2 sample past-paper questions (e.g. 4-mark, 7-mark or 14-mark) with bulleted mark-scheme point allocations drawn from the context]`;

  // Fix #1 — the model was regurgitating syllabus meta-instructions ("Candidates
  // should …") instead of the underlying history. Forbid meta-text explicitly.
  const noSyllabusMetaRule = `NO SYLLABUS META-TEXT RULE:
Never quote, paraphrase or reproduce syllabus objectives, specification meta-instructions, or examiner framing such as "Candidates should…", "Candidates will be able to…", "According to the syllabus…", or "This topic covers…". Those are instructions ABOUT content, not content. Extract only the underlying historical/factual substance and write it as direct notes; if a retrieved chunk is pure meta-instruction with no factual substance, ignore it.`;

  // Fix #1/#3 — depth-vs-density is PAPER-AWARE. Geography (2059/02) wants DIRECT,
  // DENSE bullets with zero preamble/meta-reflection (token optimisation); every
  // other subject keeps the exhaustive textbook-prose depth rule.
  const contentDepthRule = isPakGeography
    ? `CONTENT DENSITY RULE (Geography 2059/02):
Write DIRECT, DENSE, fact-packed BULLET points — each a bolded lead-in plus one terse, specific line drawn from the retrieved context (exact place-names, figures, processes). NO preamble, NO meta-reflection, NO restating the question, and NO "the context does not provide…" padding: if a fact is absent from the chunks, OMIT it silently rather than announcing the gap. Be concise and information-dense; never pad to length.`
    : `CONTENT DEPTH RULE:
For every point, provide the complete historical explanation with exact names, dates, quotations and primary sources drawn from the retrieved context. Notes must be fully fleshed-out, textbook-level PROSE — developed paragraphs a student could read instead of a textbook chapter — NOT high-level outlines, NOT bullet fragments, NOT one-line summaries. Where the context supplies detail, exhaust it; where it does not, use the insufficient-context sentence rather than inventing or padding.`;

  // Fix #1/#2 — evaluation architecture is PAPER-AWARE. Pakistan Studies Paper 2
  // (Geography) uses an Economic/Environmental/Human-Social factor framework plus
  // a part-(d) two-sided debate and a Level 3 verdict; Paper 1 (History) keeps the
  // Level-4 Cause/Counter-Factor essay architecture; other subjects stay generic.
  const section3Body = isPakGeography
    ? `This is a CAIE Pakistan Studies (${subjectCode}/02) GEOGRAPHY evaluation. Do NOT use History essay frameworks (causes/counter-factors, political narrative, "initial success vs ultimate failure"). Use the Geography AO2 factor-based architecture, written as DENSE, factor-labelled bullet points (bold lead-in + terse grounded line):
* **Economic factors:** cost, employment, GDP contribution, trade, income, agricultural/industrial output and infrastructure investment — each anchored in the retrieved context.
* **Environmental factors:** soil degradation, waterlogging, salinity, deforestation, desertification, pollution and resource depletion — anchored in the context.
* **Human / Social factors:** displacement, living standards, nomadic pastoralism, literacy, health, migration and urbanisation — anchored in the context.
* **Part (d) 6-mark two-sided debate:** for evaluative prompts ("to what extent…", "advantages and disadvantages", feasibility), argue BOTH sides explicitly (Advantages vs Disadvantages, or Feasibility vs Risk), then give a DEFINITIVE **Level 3 concluding judgement** that commits to which side is stronger and why — never fence-sit. Target the top 6-mark band.`
    : subject === "pak-studies"
      ? `This is a Pakistan Studies (${subjectCode}) evaluation — use the CAIE Level-4 (AO2) TWO-SIDED architecture for the point, written in full prose:
* **Cause / Initial Success:** 3–4 sentences on why the development began or initially succeeded, anchored in primary evidence from the context (exact dates, names, figures, quotes).
* **Counter-Factor / Ultimate Failure:** 3–4 sentences on why it broke down, was opposed, or ultimately failed, anchored in the context.
* **Level 4 Synthesising Verdict:** ONE explicit judgement paragraph weighing both sides and stating WHICH factor was most decisive and WHY, written to the top AO2 band (9–12 marks). Commit to a reasoned verdict — do not sit on the fence.`
      : `Write a developed prose evaluation, not bullets:
* **Key Causes & Background (Why it occurred):** a full cause-and-effect analysis grounded in the context.
* **Significance & Evaluation (Impact / To what extent):** a reasoned judgement of consequences and significance, targeting 7-, 10- and 14-mark essay questions.`;

  // Fix #3 — the OUTPUT-FORMAT skeleton is PAPER-AWARE. Geography (2059/02) is
  // written as DIRECT, DENSE bullets (no prose paragraphs, no preamble or
  // meta-commentary); every other subject keeps the exhaustive textbook-prose
  // skeleton. Without this branch the Geography density rule would contradict a
  // still-prose section contract ("do NOT reduce any analytical section to a
  // bullet outline" / Section 2 "NOT bullets").
  const outputFormatHeader = isPakGeography
    ? `OUTPUT FORMAT (STRICT MARKDOWN — write in DIRECT, DENSE BULLET POINTS under these exact section headings, in this order; each bullet is a bold lead-in plus ONE terse, factual line; NO prose paragraphs, NO preamble, NO meta-commentary, NO restating these instructions):`
    : `OUTPUT FORMAT (STRICT MARKDOWN — write in developed PROSE under these exact section headings, in this order; do NOT reduce any analytical section to a bullet outline):`;

  const section1Body = isPakGeography
    ? `Give 2–3 dense bullets stating what this sub-topic is, WHERE it lies (province/region, cross-checked against the SPATIAL BOUNDARY MATRIX) and why it matters. Then a compact, bulleted **Fact Bank** drawn ONLY from the context: **Key Locations & Province**, **Key Figures / Data**, and **Mandatory CAIE Technical Terms** (each defined in one terse line).`
    : `Open with a dense 4–6 sentence prose overview answering what this sub-topic is, when and where it happened, and why it matters. Then give a compact **Fact Bank** drawn only from the context: **Key Dates & Timeline**, **Key Figures / Locations**, and **Mandatory CAIE Technical Terms** (each defined in one line).`;

  const section2Body = isPakGeography
    ? `Write this as DENSE, fact-packed bullets (NOT prose paragraphs): each bullet a bolded lead-in plus ONE specific line on the physical/human geographic processes, exact place-names, figures and primary-source detail supplied by the context. Cross-check every location against the SPATIAL BOUNDARY MATRIX; omit anything the chunks do not support.`
    : `Write this as full textbook prose — several developed paragraphs, NOT bullets. Give the complete narrative and explanation: exact names, dates, treaty clauses, Qur'anic references/Hadith (Islamiyat) or physical geographic processes (Geography), quotations and primary-source detail exactly as supplied by the context. Explain the 'what' and 'how' thoroughly enough that a student needs no textbook.`;

  const section4Body = isPakGeography
    ? `Write 2–3 specific, high-value warnings as terse bullets (each may begin with ⚠️), grounded in the retrieved examiner-report / mark-scheme context: the exact misconceptions, omissions, province-mixing errors and framing traps that cost marks on this sub-topic.`
    : `Write 2–3 specific, high-value warnings in prose (each may begin with ⚠️), grounded in the retrieved examiner-report / mark-scheme context: the exact misconceptions, omissions and framing errors that cost marks on this sub-topic.`;

  return `SYSTEM PROMPT: CAIE O-LEVEL NOTE GENERATOR ENGINE

ROLE: You are an elite CAIE Subject Lead authoring comprehensive, publication-ready study notes for ${subjectName} (${subjectCode}), sub-topic "${subTopicDisplayName}". Write DIRECT, exhaustive notes that answer the topic completely. You are writing the notes themselves — never about the notes, never about the syllabus.

${withSubjectScopeMarkdown(subject)}

${groundingRule}${eventIsolationRule}${geographySpatialRule}${spatialBoundaryMatrix}${geographyKeyConcepts}

${noSyllabusMetaRule}

${contentDepthRule}

STRICT QUALITY CONSTRAINTS:
1. DUAL ASSESSMENT OBJECTIVES:
   - AO1 (Recall & Knowledge): precise dates, historical figures, treaty clauses, Qur'anic references/Hadith (for Islamiyat), and official CAIE technical vocabulary (e.g. active floodplains, depression waves, alluvial terraces, thermal rain, monsoon trough for Geography) — but ONLY where such details appear in the retrieved context.
   - AO2 (Understanding & Evaluation): clear cause-and-effect breakdowns explaining 'Why' events happened and 'To what extent' they succeeded — ${isPakGeography ? "delivered as dense, evidence-linked bullets" : "developed as prose, not fragments"}.
2. EXAM DEPTH & CONTEXT: notes must be self-contained and exam-ready — a student should not need a textbook to follow the argument. Depth must never become fabrication: if the retrieved context does not supply a specific date, name, verse, clause or mark, do NOT invent one; write exactly the insufficient-context sentence required by the guardrails for that point.
3. CAIE EXAMINER REPORT WARNINGS: an explicit section of common misconceptions and scoring traps, grounded in the retrieved examiner-report / mark-scheme context where available.
4. SAMPLE QUESTIONS: any past-paper questions and mark allocations you list must be drawn from the retrieved question-paper / mark-scheme context, not invented.${urduAddendum}

${outputFormatHeader}

# ${subTopicDisplayName} — Cambridge O-Level ${subjectCode} Notes

## 1. Executive Summary & Key Facts
${section1Body}

## 2. Comprehensive Topic Analysis (AO1 Knowledge & Evidence)
${section2Body}

## 3. High-Mark Exam Evaluation (AO2 — Causes, Effects & Impact)
${section3Body}

## 4. Examiner Report Warnings (Mistakes to Avoid)
${section4Body}

## 5. Sample Past-Paper Questions & Marking Guidance
${section5Body}

Every specific fact above MUST come from the retrieved context — depth must never become fabrication. Return ONLY the markdown document, beginning with the "# " title. No preamble, no closing commentary, no wrapping code fence.`;
}

/** Truncate a single chunk excerpt to the per-chunk cap. */
function clampExcerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_CHUNK_CHARS
    ? `${trimmed.slice(0, MAX_CHUNK_CHARS)}\u2026`
    : trimmed;
}

/** Render one chunk's non-null metadata as a compact source line. */
function formatChunkMeta(chunk: NotesContextChunk): string {
  const parts = [
    chunk.title,
    chunk.category,
    chunk.year != null ? String(chunk.year) : null,
    chunk.session,
    chunk.paperCode,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return parts.length > 0 ? parts.join(" | ") : "source metadata unavailable";
}

/**
 * Build the Notes user prompt: subject/paper/topic header plus the numbered
 * retrieved context chunks. Applies both the per-chunk and total-context
 * character budgets defensively.
 */
export function buildNotesUserPrompt(args: BuildNotesUserPromptArgs): string {
  const meta = getSubject(args.subject);
  const subjectName = meta?.name ?? args.subject;
  const subjectCode = meta?.code ?? "";
  const sectionLine = args.sectionLabel?.trim()
    ? `\nPaper / Section: ${args.sectionLabel.trim()}`
    : "";

  // Fix #3 — strict context-grounding guardrail prepended to the context block.
  const header = `CONTEXT GROUNDING: Use the provided context chunks below to construct the notes. If specific dates, figures, or casualties are present, adhere to them strictly. Do NOT pull facts from neighboring historical events (e.g., do not mix Badr and Uhud, or 1st RTC and 3rd RTC).

Subject: ${subjectName} (code ${subjectCode})${sectionLine}
Paper: ${args.paperCode}
Sub-topic: ${args.topicLabel}

Retrieved Knowledge Base Context (mark schemes, examiner reports, past papers, notes):
--------------------------------------------------`;

  const blocks: string[] = [];
  let total = header.length;
  // Subject-aware context budget: Urdu keeps the TPM-safe 8k (dense script);
  // English subjects use the larger ~11k budget so ~8–10 chunks reach the LLM.
  const budget =
    args.subject === "urdu" ? MAX_CONTEXT_CHARS_URDU : MAX_CONTEXT_CHARS;

  for (const chunk of args.chunks) {
    const excerpt = clampExcerpt(chunk.text);
    if (!excerpt) continue;
    const block = `\n\n[${chunk.id}] (${formatChunkMeta(chunk)})\n${excerpt}`;
    if (total + block.length > budget) break;
    blocks.push(block);
    total += block.length;
  }

  const footer = `\n\n--------------------------------------------------\nUsing ONLY the context above, write the full markdown study notes for "${args.topicLabel}" exactly in the required output format.`;

  return `${header}${blocks.join("")}${footer}`;
}
