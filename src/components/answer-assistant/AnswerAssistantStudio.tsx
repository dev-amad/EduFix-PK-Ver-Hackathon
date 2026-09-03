"use client";

import { useState } from "react";

import { QuestionPanel } from "@/components/answer-assistant/QuestionPanel";
import { WorkspaceEditor } from "@/components/answer-assistant/WorkspaceEditor";
import type {
  AnswerScaffoldPayload,
  AssistantApiResponse,
} from "@/lib/answer-assistant/types";

interface AnswerAssistantStudioProps {
  subjectId: string;
}

type Status = "idle" | "loading" | "error" | "success";

/**
 * Module 2 client orchestrator: owns the question and scaffold lifecycle, calls
 * the context-isolated route `POST /api/[subject]/answer-assistant`, and lays
 * out the split view — scaffolding on the left, the student's own rich-text
 * workspace on the right (PRD §8.2). The subject is fixed by the route and can
 * never be overridden from the client (rules.md §2).
 */
export function AnswerAssistantStudio({ subjectId }: AnswerAssistantStudioProps) {
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [payload, setPayload] = useState<AnswerScaffoldPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    const trimmed = question.trim();
    if (trimmed.length < 8) return;
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(`/api/${subjectId}/answer-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = (await response.json()) as AssistantApiResponse;
      if (!response.ok || !json.ok) {
        const message = json.ok
          ? `Request failed with status ${response.status}.`
          : json.error.message;
        throw new Error(message);
      }
      setPayload(json.data);
      setStatus("success");
    } catch (err) {
      setPayload(null);
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Failed to analyse the question."
      );
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <QuestionPanel
        question={question}
        payload={payload}
        error={error}
        isAnalyzing={status === "loading"}
        onQuestionChange={setQuestion}
        onAnalyze={analyze}
      />
      <WorkspaceEditor subjectId={subjectId} />
    </div>
  );
}
