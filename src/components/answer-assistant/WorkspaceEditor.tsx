"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Req #1 — sessionStorage key used to hand the student's Answering Assistant
 * workspace draft to the Answer Checker (same subject) when they click
 * "Check Answer in Answer Checker". The checker reads it once on mount and
 * clears it, so a later manual visit starts empty.
 */
export const ANSWER_TRANSFER_STORAGE_KEY =
  "edufix-pk:answer-checker:transfer-draft";

interface WorkspaceEditorProps {
  subjectId: string;
}

interface ToolbarAction {
  command: string;
  label: string;
  title: string;
  className?: string;
}

/** Formatting commands applied via the (dependency-free) execCommand API. */
const TOOLBAR: ToolbarAction[] = [
  { command: "bold", label: "B", title: "Bold", className: "font-bold" },
  { command: "italic", label: "I", title: "Italic", className: "italic" },
  {
    command: "underline",
    label: "U",
    title: "Underline",
    className: "underline",
  },
  {
    command: "insertUnorderedList",
    label: "• List",
    title: "Bullet list",
  },
];

/**
 * Task 5.1 — the student's own Rich-Text Workspace (right pane).
 *
 * This is where the learner drafts their answer using the scaffold on the
 * left. It is intentionally local and never sent to the model: Module 2 guides
 * planning, it does not compose or grade the answer. Drafts persist per subject
 * in localStorage so work is not lost on navigation.
 */
export function WorkspaceEditor({ subjectId }: WorkspaceEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const router = useRouter();

  const storageKey = `edufix-pk:answer-assistant:${subjectId}:draft`;

  const countWords = useCallback(() => {
    const text = editorRef.current?.innerText ?? "";
    const words = text.trim().split(/\s+/).filter(Boolean);
    setWordCount(words.length);
  }, []);

  // Restore this subject's draft once on mount (client-only, avoids hydration
  // mismatch) and refresh the word count.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) editor.innerHTML = saved;
    } catch {
      // localStorage may be unavailable (private mode) — ignore.
    }
    countWords();
  }, [storageKey, countWords]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const html = editorRef.current?.innerHTML ?? "";
        window.localStorage.setItem(storageKey, html);
      } catch {
        // ignore write failures
      }
    }, 400);
  }, [storageKey]);

  function handleInput() {
    countWords();
    persist();
  }

  function exec(command: string) {
    editorRef.current?.focus();
    // execCommand is deprecated but is the only dependency-free way to apply
    // inline rich-text formatting to a contentEditable selection.
    document.execCommand(command, false);
    countWords();
    persist();
  }

  function handleClear() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = "";
    setWordCount(0);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    editor.focus();
  }

  function handleTransferToChecker() {
    // Req #1 — hand the current draft (plain text) to the Answer Checker for
    // this subject. innerText (not innerHTML) is used because the checker's
    // answer field is a plain <textarea>.
    const text = editorRef.current?.innerText ?? "";
    try {
      if (text.trim().length > 0) {
        window.sessionStorage.setItem(ANSWER_TRANSFER_STORAGE_KEY, text);
      } else {
        window.sessionStorage.removeItem(ANSWER_TRANSFER_STORAGE_KEY);
      }
    } catch {
      // sessionStorage may be unavailable — navigation still proceeds.
    }
    router.push(`/${subjectId}/answer-checker`);
  }

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>Your Workspace</CardTitle>
        <CardDescription>
          Draft your own answer here using the scaffold. This text is never sent
          to the AI — it is your planning space.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TOOLBAR.map((action) => (
            <Button
              key={action.command}
              type="button"
              variant="outline"
              size="sm"
              title={action.title}
              aria-label={action.title}
              // Preserve the editor selection when a toolbar button is pressed.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => exec(action.command)}
              className={action.className}
            >
              {action.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="ms-auto text-muted-foreground"
          >
            Clear
          </Button>
        </div>

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Student answer workspace"
          onInput={handleInput}
          onBlur={persist}
          dir="auto"
          className="min-h-[320px] flex-1 rounded-lg border border-input bg-background p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&_ul]:list-disc [&_ul]:ps-5"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </p>
          <Button
            type="button"
            onClick={handleTransferToChecker}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Check Answer in Answer Checker
            <ArrowRightIcon className="size-4" aria-hidden />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
