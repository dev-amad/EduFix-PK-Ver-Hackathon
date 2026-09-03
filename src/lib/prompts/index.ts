/**
 * Public prompt API surface. Import prompt builders and guardrails from here
 * rather than reaching into individual modules.
 */

export {
  ZERO_HALLUCINATION_GUARDRAILS,
  ZERO_HALLUCINATION_GUARDRAILS_MARKDOWN,
  INSUFFICIENT_CONTEXT_SENTENCE,
  URDU_INSUFFICIENT_CONTEXT_SENTENCE,
  insufficientContextSentence,
  URDU_OUTPUT_RULES,
  withSubjectScope,
  withSubjectScopeMarkdown,
} from "@/lib/prompts/guardrails";

export {
  buildNotesSystemPrompt,
  buildNotesUserPrompt,
  MAX_CONTEXT_CHARS,
  MAX_CHUNK_CHARS,
  NOTES_MAX_TOKENS,
  NOTES_MAX_TOKENS_GEOGRAPHY,
  type NotesContextChunk,
  type BuildNotesSystemPromptArgs,
  type BuildNotesUserPromptArgs,
} from "@/lib/prompts/notes";

export {
  buildAssistantSystemPrompt,
  buildAssistantUserPrompt,
  type AssistantContextChunk,
  type BuildAssistantUserPromptArgs,
} from "@/lib/prompts/answer-assistant";

export {
  buildCheckerSystemPrompt,
  buildCheckerUserPrompt,
  type CheckerContextChunk,
  type BuildCheckerUserPromptArgs,
} from "@/lib/prompts/answer-checker";

export {
  AO3_MAX_TOKENS,
  AO3_EVALUATION_PERMISSION,
  isAO3EvaluativeQuestion,
} from "@/lib/prompts/ao3";
