/**
 * POST /api/[subject]/notes — always-on, retrieval-grounded CAIE study notes.
 *
 * The subject is derived EXCLUSIVELY from the route param (context-isolation
 * boundary, rules.md §2). The request body never supplies the subject. All
 * CAIE content is retrieved from the knowledge base; nothing is authored here.
 *
 * Note-generator re-architecture:
 *   • The selector is a 3-tier map (Subject -> Paper/Section -> Sub-topic). The
 *     body carries `paperCode` (the section id, or "all") and `topicId` (the
 *     sub-topic slug). Both are validated against the effective taxonomy and the
 *     authoritative display label is resolved server-side (never trusted from
 *     the client).
 *   • Retrieval is STRICTLY ISOLATED: kb_chunks carry a deterministic
 *     metadata.sub_topic tag spanning all 44 granular Islamiyat (17) + Pakistan
 *     Studies (27) sub-topics (scripts/lib/subtopic-tagger.ts, applied by
 *     scripts/retag-subtopics.ts). For those subjects the selected slug is
 *     passed to match_kb_chunks, which (migration 0006) keeps ONLY chunks whose
 *     metadata @> {"sub_topic": slug} — zero chunks from outside the selected
 *     sub-topic enter the context (no Uhud in a Badr query, no 3rd RTC in a 1st
 *     RTC query, no syllabus meta-text). Urdu has no granular tags (broad
 *     syllabus themes over Urdu-script text), so it passes no filter and
 *     retrieves its full general pool. The targeted semantic query (label +
 *     humanised slug + section) orders the isolated set by relevance.
 *   • Generation returns long-form MARKDOWN (CAIE AO1/AO2 engine), not JSON.
 */

import { z } from "zod";

import { isSubjectId, getSubject, type SubjectId } from "@/lib/subjects";
import { getTopicOptions } from "@/lib/kb/topics";
import { getEffectiveTaxonomy, hasSubTopicMap, slugToQueryKeywords } from "@/lib/kb/subtopics";
import { searchKnowledgeBase, type VectorSearchResult } from "@/lib/rag/search";
import { groqChat } from "@/lib/ai/groq";
import {
  buildNotesSystemPrompt,
  buildNotesUserPrompt,
  NOTES_MAX_TOKENS,
  NOTES_MAX_TOKENS_GEOGRAPHY,
  INSUFFICIENT_CONTEXT_SENTENCE,
  type NotesContextChunk,
} from "@/lib/prompts";
import type {
  NoteCitation,
  NotesApiResponse,
  NotesErrorCode,
  NotesPayload,
} from "@/lib/notes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retrieval depth: 10 chunks (dense-context directive). top_k alone was never
 * the real limiter — MAX_CONTEXT_CHARS in prompts/notes.ts is, and it is now
 * raised so ~8–10 of these actually reach the LLM instead of ~4–5.
 */
const TOP_K = 10;

/** Request body contract validated with zod v4. */
const bodySchema = z.object({
  paperCode: z.string().trim().min(1),
  topicId: z.string().trim().min(1),
  topicLabel: z.string().trim().min(1).optional(),
});

const STATUS_BY_CODE: Record<NotesErrorCode, number> = {
  INVALID_SUBJECT: 400,
  INVALID_BODY: 400,
  UNKNOWN_TOPIC: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  RETRIEVAL_FAILED: 502,
};

function jsonError(code: NotesErrorCode, message: string): Response {
  const body: NotesApiResponse = { ok: false, error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

function jsonOk(data: NotesPayload): Response {
  const body: NotesApiResponse = { ok: true, data };
  return Response.json(body, { status: 200 });
}

/** Detect Groq 429 / quota / rate-limit conditions from an unknown error. */
function isRateLimitError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: unknown }).status;
    if (status === 429) return true;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /rate.?limit|quota/i.test(code)) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|quota|too many requests/i.test(message);
}

/** Strip a whole-response ```markdown fence if the model added one, then trim. */
function cleanMarkdown(raw: string): string {
  const text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (fence?.[1] ?? text).trim();
}

/** CAIE-oriented query expansion terms per subject. */
const EXPANSIONS: Record<SubjectId, string> = {
  "pak-studies": "key dates chronology causes consequences significance",
  islamiyat: "Qur\u2019anic verses Hadith teachings significance",
  urdu: "vocabulary idioms \u0645\u062d\u0627\u0648\u0631\u0627\u062a grammar comprehension",
};

/**
 * Build the targeted semantic query that scopes retrieval to the chosen
 * sub-topic (query-side scoping).
 *
 * The query MUST stay topic-focused: lead with the subject name + sub-topic
 * display label + humanised slug, plus a few subject-relevant expansion terms.
 * Generic instruction words ("AO1/AO2", "examiner report", "common mistakes",
 * "key points definitions") are NOT retrieval signals — they dominate the
 * embedding and pull generic mark-scheme boilerplate from unrelated topics.
 * Verified against the live KB: an instruction-stuffed query returned 0/16
 * on-topic chunks for the Khilafat Movement, while this lean form returns 7/16.
 * Those instructions live in the system prompt instead.
 */
function buildQuery(
  subject: SubjectId,
  subjectName: string,
  topicLabel: string,
  slugKeywords: string
): string {
  return `${subjectName} ${topicLabel}. ${slugKeywords}. ${EXPANSIONS[subject]} marking scheme`;
}

/** Prefer joined document_* columns, falling back to the chunk metadata JSONB. */
function readMeta(row: VectorSearchResult) {
  const md = row.metadata ?? {};
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const yearRaw = row.document_year ?? md.year;
  const yearNum =
    typeof yearRaw === "number"
      ? yearRaw
      : typeof yearRaw === "string" && yearRaw.trim() !== ""
        ? Number(yearRaw)
        : NaN;
  return {
    title:
      row.document_title ?? str(md.filename) ?? str(md.title) ?? "Untitled source",
    category: row.document_category ?? str(md.category),
    paperCode: row.document_paper_code ?? str(md.paper_code),
    year: Number.isFinite(yearNum) ? yearNum : null,
    session: row.document_session ?? str(md.session),
  };
}

/** Map a retrieved chunk into the prompt's context shape with a stable id. */
function toContextChunk(row: VectorSearchResult, index: number): NotesContextChunk {
  const meta = readMeta(row);
  return {
    id: `c${index + 1}`,
    title: meta.title,
    category: meta.category,
    paperCode: meta.paperCode,
    year: meta.year,
    session: meta.session,
    text: row.content ?? "",
  };
}

/** Build the citation list (c1..cN), tolerating null document metadata. */
function toCitations(rows: VectorSearchResult[]): NoteCitation[] {
  return rows.map((row, index) => {
    const meta = readMeta(row);
    return {
      id: `c${index + 1}`,
      title: meta.title,
      category: meta.category,
      paperCode: meta.paperCode,
      year: meta.year,
      session: meta.session,
      similarity: Math.round((row.similarity ?? 0) * 1000) / 1000,
    };
  });
}

/** Call the model once for markdown notes. */
async function generateMarkdown(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const raw = await groqChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens }
  );
  return cleanMarkdown(raw);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ subject: string }> }
): Promise<Response> {
  const { subject: subjectParam } = await ctx.params;

  // 1. Subject comes ONLY from the route — the context-isolation boundary.
  if (!isSubjectId(subjectParam)) {
    return jsonError("INVALID_SUBJECT", "Unknown subject in route.");
  }
  const subject: SubjectId = subjectParam;
  const meta = getSubject(subject);
  const subjectName = meta?.name ?? subject;
  const subjectCode = meta?.code ?? "";

  // 2. Parse + validate the body (any subject-like field is ignored entirely).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError("INVALID_BODY", "Request body is missing required fields.");
  }
  const { paperCode, topicId } = parsedBody.data;

  // 3. Validate section + sub-topic against the effective taxonomy.
  const taxonomy = getEffectiveTaxonomy(subject);
  if (!taxonomy) {
    return jsonError("UNKNOWN_TOPIC", "No taxonomy available for this subject.");
  }
  const paperKnown =
    paperCode === "all" || taxonomy.papers.some((p) => p.id === paperCode);
  if (!paperKnown) {
    return jsonError("UNKNOWN_TOPIC", "Unknown paper/section for this subject.");
  }
  const topic = getTopicOptions(taxonomy, paperCode).find((t) => t.id === topicId);
  if (!topic) {
    return jsonError("UNKNOWN_TOPIC", "Unknown sub-topic for this subject/paper.");
  }
  const topicLabel = topic.title; // authoritative — never trust the client label
  const sectionLabel =
    paperCode !== "all"
      ? taxonomy.papers.find((p) => p.id === paperCode)?.title
      : undefined;

  // 4. Retrieve context: subject-scoped semantic query PLUS a STRICT sub_topic
  //    isolation filter (Islamiyat / Pakistan Studies only). match_kb_chunks
  //    (migration 0006) keeps ONLY chunks whose metadata @> {"sub_topic": topicId};
  //    Urdu passes no filter and retrieves its full general pool.
  const query = buildQuery(
    subject,
    subjectName,
    topicLabel,
    slugToQueryKeywords(topicId)
  );

  let rows: VectorSearchResult[];
  try {
    rows = await searchKnowledgeBase(query, {
      subject_id: subject,
      topK: TOP_K,
      // Strict isolation for subjects with a granular product map (Islamiyat,
      // Pakistan Studies); Urdu (no granular tags) retrieves its general pool.
      filters: hasSubTopicMap(subject) ? { sub_topic: topicId } : undefined,
    });
  } catch (err) {
    console.error("[notes] retrieval failed:", err);
    return jsonError("RETRIEVAL_FAILED", "Failed to retrieve source context.");
  }

  // 5. No grounded context -> 200 with the guardrail notice, no LLM call.
  if (rows.length === 0) {
    const payload: NotesPayload = {
      subject,
      subjectName,
      paperCode,
      sectionLabel: sectionLabel ?? null,
      topicId,
      topicLabel,
      markdown: "",
      citations: [],
      insufficientContext: true,
      notice: INSUFFICIENT_CONTEXT_SENTENCE,
      generatedAt: new Date().toISOString(),
    };
    return jsonOk(payload);
  }

  // 6. Generate the markdown notes (one retry if the model returns nothing).
  //    Resolve the OWNING paper of the selected sub-topic so the system prompt can
  //    route Pakistan Studies Paper 2 to the dedicated Geography framework even
  //    when the request's paperCode is "all". Falls back to the request paperCode.
  const owningPaperCode =
    taxonomy.papers.find((p) => p.topics.some((t) => t.id === topicId))?.id ??
    (paperCode !== "all" ? paperCode : undefined);
  // Fix #3 — Geography (2059/02) notes are dense bullets, so they use the
  // tighter 2_500-token output cap; every other subject keeps NOTES_MAX_TOKENS.
  const isPakGeography = subject === "pak-studies" && owningPaperCode === "2";
  const maxTokens = isPakGeography ? NOTES_MAX_TOKENS_GEOGRAPHY : NOTES_MAX_TOKENS;
  const systemPrompt = buildNotesSystemPrompt({
    subject,
    subjectName,
    subjectCode,
    subTopicDisplayName: topicLabel,
    paperCode: owningPaperCode,
  });
  const chunks = rows.map(toContextChunk);
  const userPrompt = buildNotesUserPrompt({
    subject,
    paperCode,
    sectionLabel,
    topicLabel,
    chunks,
  });

  let markdown: string;
  try {
    markdown = await generateMarkdown(systemPrompt, userPrompt, maxTokens);
    if (!markdown) {
      console.error("[notes] empty markdown on first attempt; retrying once");
      markdown = await generateMarkdown(systemPrompt, userPrompt, maxTokens);
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      console.error("[notes] upstream rate limited:", err);
      return jsonError(
        "RATE_LIMITED",
        "The notes service is busy right now. Please try again shortly."
      );
    }
    console.error("[notes] generation failed:", err);
    return jsonError("UPSTREAM_ERROR", "Failed to generate notes from context.");
  }

  if (!markdown) {
    return jsonError("UPSTREAM_ERROR", "Failed to generate notes from context.");
  }

  // 7. Assemble the payload contract.
  const payload: NotesPayload = {
    subject,
    subjectName,
    paperCode,
    sectionLabel: sectionLabel ?? null,
    topicId,
    topicLabel,
    markdown,
    citations: toCitations(rows),
    insufficientContext: false,
    notice: null,
    generatedAt: new Date().toISOString(),
  };

  return jsonOk(payload);
}

export function GET(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Use POST." },
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}
