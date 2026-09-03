"use client";

import { ClipboardCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const MIN_QUESTION = 8;
const MAX_QUESTION = 2000;
const MAX_ANSWER = 8000;

const FIELD_CLASS =
  "w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

interface SubmissionFormProps {
  question: string;
  answer: string;
  totalMark: string;
  isChecking: boolean;
  error: string | null;
  onQuestionChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onTotalMarkChange: (value: string) => void;
  onCheck: () => void;
}

/**
 * Task 6.1 — Answer Checker submission form.
 *
 * Req #4 — input is restricted to typed/pasted text only; the image and PDF
 * dropzone (and its OCR flow) have been removed. Presentational only — the
 * `AnswerCheckerStudio` orchestrator owns all state and network calls. A single
 * "Check my answer" action submits the question + answer for grading.
 */
export function SubmissionForm({
  question,
  answer,
  totalMark,
  isChecking,
  error,
  onQuestionChange,
  onAnswerChange,
  onTotalMarkChange,
  onCheck,
}: SubmissionFormProps) {
  const questionLength = question.trim().length;
  const answerWords = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const questionValid =
    questionLength >= MIN_QUESTION && questionLength <= MAX_QUESTION;
  const canCheck = questionValid && answer.trim().length > 0 && !isChecking;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit your answer</CardTitle>
        <CardDescription>
          Add the question, then type or paste your answer below. We grade
          strictly against the official CAIE marking scheme.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Question + optional mark hint */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="ac-question" className="text-sm font-medium">
            Question
          </Label>
          <textarea
            id="ac-question"
            dir="auto"
            rows={3}
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="e.g. Explain why the War of Independence 1857 failed. [7]"
            className={FIELD_CLASS}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {questionLength}/{MAX_QUESTION}
              {questionLength > 0 && questionLength < MIN_QUESTION
                ? ` • ${MIN_QUESTION - questionLength} more to continue`
                : ""}
            </p>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="ac-marks"
                className="text-xs text-muted-foreground"
              >
                Total marks (optional)
              </Label>
              <input
                id="ac-marks"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={totalMark}
                onChange={(event) => onTotalMarkChange(event.target.value)}
                placeholder="—"
                className="w-16 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
          </div>
        </div>

        {/* Req #4 — text-only answer input (image/PDF dropzone removed) */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="ac-answer" className="text-sm font-medium">
            Your answer
          </Label>
          <textarea
            id="ac-answer"
            dir="auto"
            rows={10}
            value={answer}
            maxLength={MAX_ANSWER}
            onChange={(event) => onAnswerChange(event.target.value)}
            placeholder="Type or paste the answer you would write in the exam…"
            className={FIELD_CLASS}
          />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {answerWords} {answerWords === 1 ? "word" : "words"}
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <p className="font-medium text-destructive">
              Could not grade the answer
            </p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {!questionValid
              ? "Add a question (8+ characters) to continue."
              : answer.trim().length === 0
                ? "Type or paste your answer to continue."
                : "Ready to grade against the CAIE marking scheme."}
          </p>
          <Button
            type="button"
            onClick={onCheck}
            disabled={!canCheck}
            className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isChecking ? (
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            ) : (
              <ClipboardCheckIcon className="size-4" aria-hidden />
            )}
            {isChecking ? "Grading…" : "Check my answer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
