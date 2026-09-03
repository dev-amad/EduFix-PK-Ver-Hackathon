/**
 * Task 5.3 — Output validation middleware for the Guided Answering Assistant.
 *
 * PRD §4.3 (Module 2) is a CRITICAL constraint: the agent must NEVER emit full
 * paragraphs or essays. This module provides:
 *   1. prose detection over every bullet-bearing field of a scaffold draft,
 *   2. a deterministic sanitiser that collapses any offending bullet back to a
 *      single concise fragment (the hard guarantee), and
 *   3. a violation report the route uses to trigger a corrective retry.
 *
 * The limits live in ./limits.ts and are shared with the prompt builder so the
 * guidance given to the model and the guardrail applied to its output agree.
 */

import {
  MAX_BULLET_CHARS,
  MAX_BULLET_SENTENCES,
  MAX_BULLET_WORDS,
  MAX_OUTLINE_FOCUS_WORDS,
} from "@/lib/answer-assistant/limits";

/** The bullet-bearing shape produced by the model and consumed by the UI. */
export interface ScaffoldDraft {
  structure: string[];
  keyPoints: { text: string; terms: string[] }[];
  requiredReferences: { text: string; terms: string[] }[];
  paragraphOutline: { label: string; focus: string }[];
}

/** Sentence terminators, including the Urdu full stop (۔ U+06D4). */
const SENTENCE_TERMINATORS = /[.!?۔]/;

/** Count whitespace-separated words (works for both Latin and Urdu script). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Approximate sentence count by splitting on terminators. */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const parts = trimmed
    .split(SENTENCE_TERMINATORS)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length || 1;
}

/**
 * True when a fragment reads as prose rather than a bullet: it contains an
 * internal line break, or exceeds the word / sentence / character limits.
 */
export function isProseLike(text: string, maxWords = MAX_BULLET_WORDS): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[\n\r]/.test(trimmed)) return true;
  if (countWords(trimmed) > maxWords) return true;
  if (countSentences(trimmed) > MAX_BULLET_SENTENCES) return true;
  if (trimmed.length > MAX_BULLET_CHARS) return true;
  return false;
}

/**
 * Force a fragment into a single concise bullet: collapse all whitespace, keep
 * at most MAX_BULLET_SENTENCES sentences, then cap by word and character count.
 */
export function sanitiseBullet(
  text: string,
  maxWords = MAX_BULLET_WORDS,
  maxChars = MAX_BULLET_CHARS
): string {
  let cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  // Keep only the first allowed number of sentences (terminators preserved).
  const sentences = cleaned.match(/[^.!?۔]+[.!?۔]*/g) ?? [cleaned];
  const trimmedSentences = sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (trimmedSentences.length > MAX_BULLET_SENTENCES) {
    cleaned = trimmedSentences.slice(0, MAX_BULLET_SENTENCES).join(" ").trim();
  }

  // Cap by word count at a word boundary.
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length > maxWords) {
    cleaned = `${words.slice(0, maxWords).join(" ").trim()}\u2026`;
  }

  // Hard character cap.
  if (cleaned.length > maxChars) {
    cleaned = `${cleaned.slice(0, maxChars).trimEnd()}\u2026`;
  }

  return cleaned;
}

/**
 * Report every field that violates the bullet-only constraint. An empty array
 * means the draft is safe to serve; a non-empty array triggers a retry.
 */
export function findProseViolations(draft: ScaffoldDraft): string[] {
  const violations: string[] = [];

  draft.structure.forEach((line, index) => {
    if (isProseLike(line)) violations.push(`structure[${index}]`);
  });
  draft.keyPoints.forEach((bullet, index) => {
    if (isProseLike(bullet.text)) violations.push(`keyPoints[${index}]`);
  });
  draft.requiredReferences.forEach((bullet, index) => {
    if (isProseLike(bullet.text)) violations.push(`requiredReferences[${index}]`);
  });
  draft.paragraphOutline.forEach((step, index) => {
    if (isProseLike(step.focus, MAX_OUTLINE_FOCUS_WORDS)) {
      violations.push(`paragraphOutline[${index}]`);
    }
  });

  return violations;
}

/**
 * Deterministically enforce the bullet-only invariant across the whole draft.
 * This is the hard guarantee applied after any retry, so even a stubborn model
 * response can never surface a paragraph to the student. Returns whether any
 * field had to be shortened so the route can flag it transparently.
 */
export function enforceBulletOnly(draft: ScaffoldDraft): {
  draft: ScaffoldDraft;
  corrected: boolean;
} {
  let corrected = false;

  const clean = (text: string, maxWords = MAX_BULLET_WORDS): string => {
    const result = sanitiseBullet(text, maxWords);
    if (result !== text.trim()) corrected = true;
    return result;
  };

  const cleanBullets = (
    bullets: { text: string; terms: string[] }[],
    maxWords = MAX_BULLET_WORDS
  ) =>
    bullets
      .map((bullet) => ({ text: clean(bullet.text, maxWords), terms: bullet.terms }))
      .filter((bullet) => bullet.text.length > 0);

  return {
    draft: {
      structure: draft.structure
        .map((line) => clean(line))
        .filter((line) => line.length > 0),
      keyPoints: cleanBullets(draft.keyPoints),
      requiredReferences: cleanBullets(draft.requiredReferences),
      paragraphOutline: draft.paragraphOutline
        .map((step) => ({
          label: step.label.replace(/\s+/g, " ").trim(),
          focus: clean(step.focus, MAX_OUTLINE_FOCUS_WORDS),
        }))
        .filter((step) => step.focus.length > 0),
    },
    corrected,
  };
}
