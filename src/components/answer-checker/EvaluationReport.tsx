"use client";

import {
  AwardIcon,
  CircleCheckIcon,
  FileTextIcon,
  InfoIcon,
  LightbulbIcon,
  TriangleAlertIcon,
  TrophyIcon,
} from "lucide-react";

import { ScoreRadial } from "@/components/answer-checker/ScoreRadial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { GradePayload } from "@/lib/answer-checker/types";

/** A coloured callout box: strengths (green), missing AO1 facts (amber), AO2 analysis (indigo). */
function Callout({
  tone,
  icon: Icon,
  title,
  items,
  emptyLabel,
}: {
  tone: "positive" | "warning" | "analysis";
  icon: typeof CircleCheckIcon;
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  const shell = {
    positive:
      "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/40",
    warning:
      "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/40",
    analysis:
      "border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/40",
  }[tone];
  const iconWrap = {
    positive:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200",
    warning:
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
    analysis:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200",
  }[tone];
  const bullet = {
    positive: "bg-emerald-500",
    warning: "bg-amber-500",
    analysis: "bg-indigo-500",
  }[tone];

  return (
    <section className={`flex flex-col gap-3 rounded-lg border p-4 ${shell}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span
          className={`flex size-7 items-center justify-center rounded-md ${iconWrap}`}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2.5 text-sm leading-relaxed">
              <span
                aria-hidden
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${bullet}`}
              />
              <span dir="auto">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

/**
 * Req #3 — the retrieved marking-scheme sources list is intentionally hidden
 * from the UI. `payload.citations` stays in the state/API payload (untouched);
 * only the visual render node is suppressed. Flip to true to restore the list.
 */
const SHOW_RETRIEVED_SOURCES: boolean = false;

/**
 * Task 6.4 — Evaluation Dashboard.
 *
 * Renders the structured grading report: score radial + CAIE level badge, then
 * the 3-tier actionable feedback — Tier 1 missing factual points (AO1, amber),
 * Tier 2 required Level 4 evaluation (AO2, indigo) and Tier 3 model answer
 * paragraph behind a modal — plus strengths (green), plain-English feedback and
 * the retrieved marking-scheme sources (PRD §4.3 / §8.2).
 */
export function EvaluationReport({ payload }: { payload: GradePayload }) {
  const hasExemplar = payload.exemplar.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrophyIcon className="size-5 text-emerald-600" aria-hidden />
          Evaluation Report
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Score radial + level badge + exemplar trigger */}
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <ScoreRadial assigned={payload.assignedMark} total={payload.totalMark} />
          <div className="flex flex-1 flex-col items-center gap-3 sm:items-start">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                CAIE Level
              </p>
              {payload.assignedLevel ? (
                <Badge className="gap-1.5 border-transparent bg-emerald-600 px-3 py-1 text-sm font-medium text-white">
                  <AwardIcon className="size-3.5" aria-hidden />
                  <span dir="auto">{payload.assignedLevel}</span>
                </Badge>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No level descriptor found in the retrieved marking scheme.
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {payload.assignedMark}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-foreground">
                {payload.totalMark}
              </span>{" "}
              marks awarded
            </p>
            {hasExemplar ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-emerald-300 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950"
                  >
                    <FileTextIcon className="size-4" aria-hidden />
                    View model answer paragraph
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <TrophyIcon
                        className="size-5 text-emerald-600"
                        aria-hidden
                      />
                      Model answer paragraph
                    </DialogTitle>
                    <DialogDescription>
                      A fully-written, exam-ready paragraph grounded in the
                      official marking scheme, showing how to weave in the
                      missing AO1 facts and the Level 4 (AO2) analysis.
                    </DialogDescription>
                  </DialogHeader>
                  <div
                    dir="auto"
                    className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed"
                  >
                    {payload.exemplar}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        </div>

        {payload.insufficientContext && payload.notice ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p dir="auto">{payload.notice}</p>
          </div>
        ) : null}

        {/* Strengths vs. gaps */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Callout
            tone="positive"
            icon={CircleCheckIcon}
            title="Strengths"
            items={payload.strengths}
            emptyLabel="No specific strengths were identified from the marking scheme."
          />
          <Callout
            tone="warning"
            icon={TriangleAlertIcon}
            title="Missing factual points (AO1)"
            items={payload.missingElements}
            emptyLabel="No missing facts were flagged for this answer."
          />
        </div>

        {/* Tier 2 — Required Level 4 evaluation (AO2 analysis) */}
        <Callout
          tone="analysis"
          icon={LightbulbIcon}
          title="Required Level 4 evaluation (AO2 analysis)"
          items={payload.requiredEvaluation}
          emptyLabel="No further Level 4 evaluation was needed — the answer already reaches the top level, or this is a pure AO1 recall question."
        />

        {/* Plain-English feedback */}
        {payload.explanation ? (
          <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <InfoIcon className="size-4" aria-hidden />
              </span>
              How to reach full marks
            </h3>
            <p dir="auto" className="text-sm leading-relaxed text-muted-foreground">
              {payload.explanation}
            </p>
          </section>
        ) : null}

        {/* Retrieved marking-scheme sources */}
        {SHOW_RETRIEVED_SOURCES && payload.citations.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <FileTextIcon className="size-4" aria-hidden />
              </span>
              Grading grounded in
            </h3>
            <ul className="flex flex-col gap-1">
              {payload.citations.map((citation, index) => {
                const details = [
                  citation.category,
                  citation.paperCode,
                  citation.session,
                  citation.year != null ? String(citation.year) : null,
                ].filter(
                  (part): part is string =>
                    typeof part === "string" && part.length > 0
                );
                return (
                  <li
                    key={citation.id ?? index}
                    className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span dir="auto" className="truncate">
                      <span className="font-mono">[{citation.id ?? index}]</span>{" "}
                      {citation.title}
                      {details.length > 0 ? ` — ${details.join(", ")}` : ""}
                    </span>
                    {typeof citation.similarity === "number" ? (
                      <span className="shrink-0">
                        {Math.round(citation.similarity * 100)}%
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
