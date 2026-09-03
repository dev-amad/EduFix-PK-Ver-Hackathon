"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  InfoIcon,
  PrinterIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { NotesPayload } from "@/lib/notes/types";
import { serialiseNotesToText } from "@/lib/notes/serialize";

interface NotesResultsProps {
  payload: NotesPayload;
  isGenerating: boolean;
  onRegenerate: () => void;
}

/** Best-effort clipboard write with a legacy fallback for insecure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/**
 * Tailwind-styled renderers for the generated markdown so the notes match the
 * emerald theme without depending on a typography plugin. Every text node uses
 * dir="auto" so Urdu-script notes render right-to-left inline.
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1
      dir="auto"
      className="mt-1 mb-4 text-2xl font-semibold tracking-tight text-foreground"
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      dir="auto"
      className="mt-7 mb-3 border-b border-border pb-2 text-lg font-semibold text-emerald-700 dark:text-emerald-400"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 dir="auto" className="mt-5 mb-2 text-base font-semibold text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      dir="auto"
      className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p dir="auto" className="my-2 text-sm leading-relaxed text-foreground">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 flex list-disc flex-col gap-1.5 ps-5 text-sm marker:text-emerald-600">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 flex list-decimal flex-col gap-1.5 ps-5 text-sm marker:text-emerald-600">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li dir="auto" className="leading-relaxed text-foreground">
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote
      dir="auto"
      className="my-3 border-s-2 border-emerald-500 ps-3 text-sm italic text-muted-foreground"
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-border" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
  th: ({ children }) => (
    <th dir="auto" className="px-2 py-1.5 text-start font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td dir="auto" className="px-2 py-1.5 align-top">
      {children}
    </td>
  ),
};

/**
 * Req #3 — the retrieved-sources card (and the header source count) is
 * intentionally hidden from the UI. `payload.citations` stays in the state/API
 * payload (untouched); only the visual render nodes are suppressed. Flip to
 * true to restore them.
 */
const SHOW_RETRIEVED_SOURCES: boolean = false;

/**
 * The generated Notes panel: long-form markdown study notes (CAIE AO1/AO2
 * engine) plus retrieved-source citations, copy-to-clipboard and PDF export.
 *
 * The whole panel is the print root (`#notes-print-area`); interactive chrome is
 * hidden from the exported PDF via Tailwind's `print:hidden` variant.
 */
export function NotesResults({
  payload,
  isGenerating,
  onRegenerate,
}: NotesResultsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(serialiseNotesToText(payload));
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const showNotice =
    payload.insufficientContext || payload.markdown.trim().length === 0;
  const scope = payload.sectionLabel?.trim() || `Paper ${payload.paperCode}`;

  return (
    <div id="notes-print-area" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight" dir="auto">
            {payload.topicLabel}
          </h2>
          <p className="text-sm text-muted-foreground">
            {payload.subjectName} • {scope}
            {SHOW_RETRIEVED_SOURCES
              ? ` • ${payload.citations.length} source${
                  payload.citations.length === 1 ? "" : "s"
                }`
              : ""}
            {" • "}
            {formatTimestamp(payload.generatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            aria-live="polite"
          >
            {copied ? (
              <CheckIcon className="size-4 text-emerald-600" />
            ) : (
              <CopyIcon className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <PrinterIcon className="size-4" />
            Export PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onRegenerate}
            disabled={isGenerating}
          >
            <RefreshCwIcon
              className={isGenerating ? "size-4 animate-spin" : "size-4"}
            />
            Regenerate
          </Button>
        </div>
      </div>

      {showNotice ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p dir="auto">
            {payload.notice?.trim() ||
              "No grounded notes could be retrieved for this sub-topic."}
          </p>
        </div>
      ) : (
        <Card className="print:break-inside-auto">
          <CardContent className="pt-6">
            <div dir="auto" className="notes-markdown flex flex-col">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {payload.markdown}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}

      {SHOW_RETRIEVED_SOURCES && payload.citations.length > 0 ? (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileTextIcon className="size-4 text-emerald-700" aria-hidden />
              Retrieved sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
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
                    key={citation.id ?? `c${index}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span dir="auto" className="text-foreground">
                        <span className="font-mono text-xs text-muted-foreground">
                          [{citation.id ?? `c${index}`}]
                        </span>{" "}
                        {citation.title}
                      </span>
                      {details.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {details.join(" • ")}
                        </span>
                      ) : null}
                    </span>
                    {typeof citation.similarity === "number" ? (
                      <Badge variant="outline" className="shrink-0 font-normal">
                        {Math.round(citation.similarity * 100)}% match
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
