"use client";

import { WandSparklesIcon } from "lucide-react";

import { ScaffoldView } from "@/components/answer-assistant/ScaffoldView";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { AnswerScaffoldPayload } from "@/lib/answer-assistant/types";

const MIN_QUESTION = 8;
const MAX_QUESTION = 2000;

interface QuestionPanelProps {
  question: string;
  payload: AnswerScaffoldPayload | null;
  error: string | null;
  isAnalyzing: boolean;
  onQuestionChange: (value: string) => void;
  onAnalyze: () => void;
}

function ScaffoldSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      {[56, 96, 80, 120].map((width, index) => (
        <div
          key={index}
          className="h-3 animate-pulse rounded bg-muted/70"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Task 5.1 — the left pane: question input plus the AI scaffold output.
 * The student pastes a question; the guided plan renders below as bullets only.
 */
export function QuestionPanel({
  question,
  payload,
  error,
  isAnalyzing,
  onQuestionChange,
  onAnalyze,
}: QuestionPanelProps) {
  const length = question.trim().length;
  const canAnalyze = length >= MIN_QUESTION && length <= MAX_QUESTION;
  const showSkeleton = isAnalyzing && !payload;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Question &amp; Scaffold</CardTitle>
        <CardDescription>
          Paste a past-paper or practice question. The assistant returns a
          bullet-only plan — it never writes the answer for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="aa-question" className="text-sm font-medium">
            Question
          </Label>
          <textarea
            id="aa-question"
            dir="auto"
            rows={4}
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (canAnalyze && !isAnalyzing) onAnalyze();
              }
            }}
            placeholder="e.g. Explain why the War of Independence 1857 failed. [7]"
            className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {length}/{MAX_QUESTION}
              {length > 0 && length < MIN_QUESTION
                ? ` • ${MIN_QUESTION - length} more to analyse`
                : " • Ctrl/⌘ + Enter"}
            </p>
            <Button
              type="button"
              onClick={onAnalyze}
              disabled={!canAnalyze || isAnalyzing}
              className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              ) : (
                <WandSparklesIcon className="size-4" />
              )}
              {isAnalyzing ? "Analysing…" : "Analyse question"}
            </Button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <p className="font-medium text-destructive">
              Could not analyse the question
            </p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        ) : null}

        {showSkeleton ? <ScaffoldSkeleton /> : null}

        {payload && !showSkeleton ? <ScaffoldView payload={payload} /> : null}

        {!payload && !error && !isAnalyzing ? (
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            Enter a question and select <span className="font-medium">Analyse</span>{" "}
            to build a mark-winning plan grounded in the official CAIE knowledge
            base.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
