"use client";

import { useEffect, useState } from "react";

import { ANSWER_TRANSFER_STORAGE_KEY } from "@/components/answer-assistant/WorkspaceEditor";
import { EvaluationReport } from "@/components/answer-checker/EvaluationReport";
import { SubmissionForm } from "@/components/answer-checker/SubmissionForm";
import { Card, CardContent } from "@/components/ui/card";
import type {
  CheckerApiResponse,
  GradePayload,
} from "@/lib/answer-checker/types";

interface AnswerCheckerStudioProps {
  subjectId: string;
}

type Status = "idle" | "loading" | "error" | "success";

/**
 * Module 3 client orchestrator: owns the submission and grading lifecycle.
 * Grading posts to the context-isolated `/api/[subject]/answer-checker` route,
 * so the subject is fixed by the route and can never be overridden from the
 * client (rules.md §2).
 *
 * Req #4 — input is text-only; the image/PDF dropzone and its OCR flow have
 * been removed, so submission reads the typed answer directly.
 * Req #1 — on mount, hydrate the answer textarea from a draft transferred from
 * the Answering Assistant workspace (via sessionStorage), then clear the key so
 * a later manual visit starts empty.
 */
export function AnswerCheckerStudio({ subjectId }: AnswerCheckerStudioProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [totalMark, setTotalMark] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [payload, setPayload] = useState<GradePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Req #1 — pull in a transferred Answering Assistant draft (if present).
  useEffect(() => {
    try {
      const incoming = window.sessionStorage.getItem(
        ANSWER_TRANSFER_STORAGE_KEY
      );
      if (incoming && incoming.trim().length > 0) {
        setAnswer(incoming);
      }
      window.sessionStorage.removeItem(ANSWER_TRANSFER_STORAGE_KEY);
    } catch {
      // sessionStorage may be unavailable (private mode) — ignore.
    }
  }, []);

  async function handleCheck() {
    const trimmedQuestion = question.trim();
    const trimmedAnswer = answer.trim();
    if (trimmedQuestion.length < 8 || trimmedAnswer.length === 0) return;

    setStatus("loading");
    setError(null);

    const markHint = Number.parseInt(totalMark, 10);
    const body: { question: string; answer: string; totalMark?: number } = {
      question: trimmedQuestion,
      answer: trimmedAnswer,
    };
    if (Number.isFinite(markHint) && markHint > 0) body.totalMark = markHint;

    try {
      const response = await fetch(`/api/${subjectId}/answer-checker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as CheckerApiResponse;
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
        err instanceof Error ? err.message : "Failed to grade the answer."
      );
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <SubmissionForm
        question={question}
        answer={answer}
        totalMark={totalMark}
        isChecking={status === "loading"}
        error={error}
        onQuestionChange={setQuestion}
        onAnswerChange={setAnswer}
        onTotalMarkChange={setTotalMark}
        onCheck={handleCheck}
      />

      <div className="flex flex-col gap-6 lg:sticky lg:top-20">
        {status === "loading" ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-600"
              />
              Grading your answer against the official CAIE marking scheme…
            </CardContent>
          </Card>
        ) : null}

        {payload && status === "success" ? (
          <EvaluationReport payload={payload} />
        ) : null}

        {status !== "loading" && !payload ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Your CAIE evaluation — assigned mark, level, strengths, gaps and
              a full-mark exemplar — will appear here after you check an answer.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
