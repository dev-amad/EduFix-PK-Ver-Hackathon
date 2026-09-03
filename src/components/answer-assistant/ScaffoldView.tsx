"use client";

import type { ComponentType } from "react";
import {
  ArrowRightIcon,
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  LightbulbIcon,
  ListOrderedIcon,
  QuoteIcon,
  TargetIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AnswerScaffoldPayload, ScaffoldBullet } from "@/lib/answer-assistant/types";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

interface ScaffoldSectionProps {
  icon: IconComponent;
  title: string;
  children: React.ReactNode;
}

function ScaffoldSection({ icon: Icon, title, children }: ScaffoldSectionProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex size-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Icon className="size-4" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A bullet list where each item surfaces its CAIE terminology as badges. */
function BulletList({ bullets }: { bullets: ScaffoldBullet[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {bullets.map((bullet, index) => (
        <li key={index} className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500"
          />
          <div className="flex flex-col gap-1.5">
            <p dir="auto" className="text-sm leading-relaxed text-foreground">
              {bullet.text}
            </p>
            {bullet.terms.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {bullet.terms.map((term, termIndex) => (
                  <Badge
                    key={termIndex}
                    variant="outline"
                    dir="auto"
                    className="border-emerald-200 bg-emerald-50/60 font-normal text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                  >
                    {term}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Req #3 — the retrieved-sources panel is intentionally hidden from the UI.
 * `payload.citations` stays in the state/API payload (untouched); only the
 * visual render node is suppressed. Flip to true to restore the list.
 */
const SHOW_RETRIEVED_SOURCES: boolean = false;

/**
 * Task 5.1 — the scaffolding panel output (left pane). Renders the guided plan
 * as bullets only: command word, structure, key points, required references and
 * a short paragraph outline. No composed answer is ever displayed here.
 */
export function ScaffoldView({ payload }: { payload: AnswerScaffoldPayload }) {
  const hasHead = payload.commandWord != null || payload.markAllocation != null;

  return (
    <div className="flex flex-col gap-5">
      {hasHead ? (
        <div className="flex flex-wrap items-center gap-2">
          {payload.commandWord ? (
            <Badge className="gap-1.5 border-transparent bg-emerald-600 text-white">
              <TargetIcon className="size-3" />
              Command: {payload.commandWord}
            </Badge>
          ) : null}
          {payload.markAllocation != null ? (
            <Badge
              variant="outline"
              className="border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200"
            >
              Target: {payload.markAllocation} mark
              {payload.markAllocation === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {payload.guardrail ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{payload.guardrail}</p>
        </div>
      ) : null}

      {payload.insufficientContext && payload.notice ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p dir="auto">{payload.notice}</p>
        </div>
      ) : null}

      {payload.structure.length > 0 ? (
        <ScaffoldSection icon={LayersIcon} title="How to build this answer">
          <ul className="flex flex-col gap-1.5">
            {payload.structure.map((line, index) => (
              <li key={index} className="flex gap-2.5 text-sm text-foreground">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500"
                />
                <span dir="auto">{line}</span>
              </li>
            ))}
          </ul>
        </ScaffoldSection>
      ) : null}

      {payload.keyPoints.length > 0 ? (
        <ScaffoldSection icon={LightbulbIcon} title="Key points from the mark scheme">
          <BulletList bullets={payload.keyPoints} />
        </ScaffoldSection>
      ) : null}

      {payload.requiredReferences.length > 0 ? (
        <ScaffoldSection
          icon={QuoteIcon}
          title="Required references & terminology"
        >
          <BulletList bullets={payload.requiredReferences} />
        </ScaffoldSection>
      ) : null}

      {payload.paragraphOutline.length > 0 ? (
        <ScaffoldSection
          icon={ListOrderedIcon}
          title="Recommended paragraph outline"
        >
          <ol className="flex flex-col gap-2">
            {payload.paragraphOutline.map((step, index) => (
              <li
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-foreground">{step.label}</span>
                <ArrowRightIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span dir="auto" className="text-muted-foreground">
                  {step.focus}
                </span>
              </li>
            ))}
          </ol>
        </ScaffoldSection>
      ) : null}

      {SHOW_RETRIEVED_SOURCES && payload.citations.length > 0 ? (
        <ScaffoldSection icon={FileTextIcon} title="Retrieved sources">
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
                  className={cn(
                    "flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
                  )}
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
        </ScaffoldSection>
      ) : null}
    </div>
  );
}
