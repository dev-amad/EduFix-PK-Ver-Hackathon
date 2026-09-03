/**
 * Machine-enforced bullet limits for the Guided Answering Assistant.
 *
 * PRD §4.3 (Module 2) forbids full paragraphs/essays. These constants are the
 * SINGLE SOURCE OF TRUTH shared by the prompt builder (which states the limits
 * to the model) and the validation middleware (which enforces them), so the
 * guidance and the guardrail can never drift apart.
 */

/** A bullet longer than this (in words) is treated as prose. */
export const MAX_BULLET_WORDS = 32;
/** More than this many sentence terminators in one bullet reads as a paragraph. */
export const MAX_BULLET_SENTENCES = 2;
/** Hard character cap for a single bullet/structure line. */
export const MAX_BULLET_CHARS = 240;
/** A paragraph-outline focus is a pointer, not a draft — keep it very short. */
export const MAX_OUTLINE_FOCUS_WORDS = 18;
