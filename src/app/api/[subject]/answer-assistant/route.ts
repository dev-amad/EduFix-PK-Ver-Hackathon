/**
 * POST /api/[subject]/answer-assistant — scaffolding-only guided answering.
 *
 * Enforces PRD System Prompt 7.1 and the CRITICAL Module 2 constraint: the
 * response is bullet-only and NEVER a composed paragraph/essay. The subject is
 * derived EXCLUSIVELY from the route param (context isolation, rules.md §2);
 * the body only carries the student's question. Task 5.3 validation runs here:
 * prose is detected, a corrective retry is issued, and a deterministic
 * sanitiser guarantees the bullet-only invariant before anything is returned.
 */

import { z } from "zod";

import { isSubjectId, getSubject, type SubjectId } from "@/lib/subjects";
import { searchKnowledgeBase, type VectorSearchResult } from "@/lib/rag/search";
import { groqChat } from "@/lib/ai/groq";
import {
  buildAssistantSystemPrompt,
  buildAssistantUserPrompt,
  insufficientContextSentence,
  isAO3EvaluativeQuestion,
  AO3_MAX_TOKENS,
  type AssistantContextChunk,
} from "@/lib/prompts";
import {
  dedupePreserveCase,
  extractJsonObject,
  isMaxTokensTruncationError,
  isRateLimitError,
} from "@/lib/ai/response";
import {
  enforceBulletOnly,
  findProseViolations,
  type ScaffoldDraft,
} from "@/lib/answer-assistant/validate";
import {
  MAX_BULLET_WORDS,
  MAX_OUTLINE_FOCUS_WORDS,
} from "@/lib/answer-assistant/limits";
import type {
  AnswerScaffoldPayload,
  AssistantApiResponse,
  AssistantCitation,
  AssistantErrorCode,
} from "@/lib/answer-assistant/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retrieval tuning. */
const TOP_K = 10;
/**
 * Req #4 — Urdu response-token cap. The assistant is bullet-only, so a tight
 * ceiling preserves Groq free-tier quota; generateWithCap retries uncapped on
 * truncation, so the cap can never cause a 502.
 */
const URDU_MAX_TOKENS = 900;

/** Guardrail note surfaced when the sanitiser had to shorten model output. */
const CORRECTED_GUARDRAIL =
  "Some generated points exceeded the bullet-only limits and were automatically shortened. This tool scaffolds your answer — it never writes it for you.";

/** Request body contract validated with zod v4. */
const bodySchema = z.object({
  question: z.string().trim().min(8).max(2000),
});

const bulletSchema = z.object({
  text: z.string().optional().default(""),
  terms: z.array(z.string()).optional().default([]),
});

const outlineSchema = z.object({
  label: z.string().optional().default(""),
  focus: z.string().optional().default(""),
});

/** Loose model-output schema; prose limits are enforced after parsing. */
const modelSchema = z.object({
  commandWord: z.string().optional().default(""),
  markAllocation: z.number().int().min(0).max(100).optional().nullable(),
  structure: z.array(z.string()).optional().default([]),
  keyPoints: z.array(bulletSchema).optional().default([]),
  requiredReferences: z.array(bulletSchema).optional().default([]),
  paragraphOutline: z.array(outlineSchema).optional().default([]),
});

type ModelOutput = z.infer<typeof modelSchema>;

const STATUS_BY_CODE: Record<AssistantErrorCode, number> = {
  INVALID_SUBJECT: 400,
  INVALID_BODY: 400,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  RETRIEVAL_FAILED: 502,
};

function jsonError(code: AssistantErrorCode, message: string): Response {
  const body: AssistantApiResponse = { ok: false, error: { code, message } };
  return Response.json(body, { status: STATUS_BY_CODE[code] });
}

function jsonOk(data: AnswerScaffoldPayload): Response {
  const body: AssistantApiResponse = { ok: true, data };
  return Response.json(body, { status: 200 });
}

/** Build the semantic retrieval query from the question + subject expansion. */
function buildQuery(
  subject: SubjectId,
  subjectName: string,
  question: string
): string {
  const expansions: Record<SubjectId, string> = {
    "pak-studies": "causes consequences significance dates marking scheme levels",
    islamiyat: "Qur\u2019anic verses Hadith references part (a) part (b) marking scheme",
    urdu: "vocabulary idioms \u0645\u062d\u0627\u0648\u0631\u0627\u062a format directed writing marking scheme",
  };
  return `${subjectName} CAIE O Level. ${question} command word key points required references structure ${expansions[subject]}`;
}

/** Map a retrieved chunk into the prompt's context shape with a stable id. */
function toContextChunk(
  row: VectorSearchResult,
  index: number
): AssistantContextChunk {
  return {
    id: `c${index + 1}`,
    title: row.document_title,
    category: row.document_category,
    paperCode: row.document_paper_code,
    year: row.document_year,
    session: row.document_session,
    text: row.content ?? "",
  };
}

/** Build the citation list (c1..cN), tolerating null metadata. */
function toCitations(rows: VectorSearchResult[]): AssistantCitation[] {
  return rows.map((row, index) => ({
    id: `c${index + 1}`,
    title: row.document_title ?? "Untitled source",
    category: row.document_category,
    paperCode: row.document_paper_code,
    year: row.document_year,
    session: row.document_session,
    similarity: Math.round((row.similarity ?? 0) * 1000) / 1000,
  }));
}

/** Normalise loose model output into the bullet-bearing draft shape. */
function toDraft(model: ModelOutput): ScaffoldDraft {
  const cleanBullets = (
    bullets: { text: string; terms: string[] }[]
  ): { text: string; terms: string[] }[] =>
    bullets
      .map((bullet) => ({
        text: bullet.text.trim(),
        terms: dedupePreserveCase(bullet.terms),
      }))
      .filter((bullet) => bullet.text.length > 0);

  return {
    structure: model.structure
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean),
    keyPoints: cleanBullets(model.keyPoints),
    requiredReferences: cleanBullets(model.requiredReferences),
    paragraphOutline: model.paragraphOutline
      .map((step, index) => ({
        label: step.label.trim() || `Paragraph ${index + 1}`,
        focus: step.focus.replace(/\s+/g, " ").trim(),
      }))
      .filter((step) => step.focus.length > 0),
  };
}

/** Call the model once and validate the schema; throws on unusable output. */
async function generateOnce(
  systemPrompt: string,
  userPrompt: string,
  violations?: string[],
  maxTokens?: number
): Promise<ModelOutput> {
  const messages: Parameters<typeof groqChat>[0] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  if (violations && violations.length > 0) {
    messages.push({
      role: "user",
      content:
        `Your previous reply broke the bullet-only rule in these fields: ${violations.join(", ")}. ` +
        `Rewrite them as STRICTLY bulleted short fragments (max ${MAX_BULLET_WORDS} words and 2 sentences each; ` +
        `outline "focus" max ${MAX_OUTLINE_FOCUS_WORDS} words). Never write a paragraph. ` +
        `Reply with ONLY the single JSON object, no markdown fences and no prose.`,
    });
  }

  const raw = await groqChat(messages, {
    temperature: 0.1,
    json: true,
    maxTokens,
  });
  const parsed = extractJsonObject(raw);
  const result = modelSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Model output failed schema validation.");
  }
  return result.data;
}

/**
 * Req #4 — call generateOnce under a response-token cap, retrying ONCE uncapped
 * if the cap truncated the JSON (Groq hard-fails truncation as
 * json_validate_failed). Only engages when a cap is actually applied (Urdu /
 * AO3), so Islamiyat and non-AO3 Pakistan Studies behaviour is unchanged.
 */
async function generateWithCap(
  systemPrompt: string,
  userPrompt: string,
  violations: string[] | undefined,
  maxTokens: number | undefined
): Promise<ModelOutput> {
  try {
    return await generateOnce(systemPrompt, userPrompt, violations, maxTokens);
  } catch (err) {
    if (
      maxTokens != null &&
      isMaxTokensTruncationError(err) &&
      !isRateLimitError(err)
    ) {
      console.warn("[answer-assistant] reply hit the token cap; retrying uncapped.");
      return generateOnce(systemPrompt, userPrompt, violations, undefined);
    }
    throw err;
  }
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
  const insufficientSentence = insufficientContextSentence(subject);

  // 2. Parse + validate the body (only the question is accepted).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("INVALID_BODY", "Request body must be valid JSON.");
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError(
      "INVALID_BODY",
      "Provide a question between 8 and 2000 characters."
    );
  }
  const question = parsedBody.data.question;

  // Fix #2/#3 — AO3 (6-mark part d) evaluative detection. Gate the AO3
  // permission (Fix #1) and the 2000-token cap (Fix #3) to Pakistan Studies
  // evaluative prompts ONLY, so AO1/AO2 factual questions keep strict grounding.
  const isAO3 = subject === "pak-studies" && isAO3EvaluativeQuestion(question);
  // Req #4 — cap response tokens where safe: AO3 keeps its 2,000-token budget;
  // Urdu gets a tighter cap (the URDU_OUTPUT_RULES contract forces terse
  // output). generateWithCap retries uncapped on truncation, so a cap never 502s.
  const isUrdu = subject === "urdu";
  const capMaxTokens = isAO3
    ? AO3_MAX_TOKENS
    : isUrdu
      ? URDU_MAX_TOKENS
      : undefined;

  // 3. Retrieve subject-scoped context for the question.
  const query = buildQuery(subject, subjectName, question);
  let rows: VectorSearchResult[];
  try {
    rows = await searchKnowledgeBase(query, { subject_id: subject, topK: TOP_K });
  } catch (err) {
    console.error("[answer-assistant] retrieval failed:", err);
    return jsonError("RETRIEVAL_FAILED", "Failed to retrieve source context.");
  }

  const basePayload = {
    subject,
    subjectName,
    question,
    citations: toCitations(rows),
    generatedAt: new Date().toISOString(),
  };

  // 4. No grounded context → 200 with the guardrail notice, no LLM call.
  if (rows.length === 0) {
    const payload: AnswerScaffoldPayload = {
      ...basePayload,
      commandWord: null,
      markAllocation: null,
      structure: [],
      keyPoints: [],
      requiredReferences: [],
      paragraphOutline: [],
      insufficientContext: true,
      notice: insufficientSentence,
      guardrail: null,
    };
    return jsonOk(payload);
  }

  // 5. Generate (System Prompt 7.1), then run the Task 5.3 middleware.
  const systemPrompt = buildAssistantSystemPrompt(subject, { isAO3 });
  const chunks = rows.map(toContextChunk);
  const userPrompt = buildAssistantUserPrompt({ subject, question, chunks });

  let draft: ScaffoldDraft;
  let commandWord: string;
  let markAllocation: number | null;
  try {
    let model = await generateWithCap(
      systemPrompt,
      userPrompt,
      undefined,
      capMaxTokens
    );
    let normalized = toDraft(model);

    // 5a. Prose detected → single corrective retry (PRD Module 2 constraint).
    const violations = findProseViolations(normalized);
    if (violations.length > 0) {
      console.warn(
        `[answer-assistant] prose detected in ${violations.length} field(s); retrying:`,
        violations
      );
      model = await generateWithCap(
        systemPrompt,
        userPrompt,
        violations,
        capMaxTokens
      );
      normalized = toDraft(model);
    }

    draft = normalized;
    commandWord = model.commandWord.trim();
    markAllocation = model.markAllocation ?? null;
  } catch (err) {
    if (isRateLimitError(err)) {
      console.error("[answer-assistant] upstream rate limited:", err);
      return jsonError(
        "RATE_LIMITED",
        "The answering assistant is busy right now. Please try again shortly."
      );
    }
    console.error("[answer-assistant] generation failed:", err);
    return jsonError(
      "UPSTREAM_ERROR",
      "Failed to generate the answer scaffold from context."
    );
  }

  // 5b. Hard guarantee: force bullet-only even if the retry still returned prose.
  const enforced = enforceBulletOnly(draft);
  const empty =
    enforced.draft.keyPoints.length === 0 &&
    enforced.draft.structure.length === 0;

  const payload: AnswerScaffoldPayload = {
    ...basePayload,
    commandWord: commandWord.length > 0 ? commandWord : null,
    markAllocation,
    structure: enforced.draft.structure,
    keyPoints: enforced.draft.keyPoints,
    requiredReferences: enforced.draft.requiredReferences,
    paragraphOutline: enforced.draft.paragraphOutline,
    insufficientContext: empty,
    notice: empty ? insufficientSentence : null,
    guardrail: enforced.corrected ? CORRECTED_GUARDRAIL : null,
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
