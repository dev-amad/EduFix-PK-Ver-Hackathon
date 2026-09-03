/**
 * Plain-text serialisation of a NotesPayload.
 *
 * Used by the Notes UI for copy-to-clipboard and as the readable source for the
 * print/PDF export. Since the note-generator re-architecture the payload body is
 * already Markdown, so this simply returns it verbatim plus a sources footer.
 *
 * Intentionally free of React and icon dependencies so it stays trivially
 * testable and isomorphic. No CAIE content is authored here — everything is
 * taken verbatim from the API payload, which is grounded in the retrieved
 * knowledge base.
 */

import type { NoteCitation, NotesPayload } from "@/lib/notes/types";

function formatCitation(citation: NoteCitation, index: number): string {
  const details = [
    citation.category,
    citation.paperCode,
    citation.session,
    citation.year != null ? String(citation.year) : null,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);

  const similarity =
    typeof citation.similarity === "number"
      ? ` (match ${Math.round(citation.similarity * 100)}%)`
      : "";

  const suffix = details.length > 0 ? ` — ${details.join(", ")}` : "";
  return `[${citation.id ?? `c${index + 1}`}] ${citation.title}${suffix}${similarity}`;
}

/**
 * Render the payload as clean, copy-friendly text: the generated Markdown notes
 * followed by the retrieved-source list. Falls back to the header + notice when
 * no grounded notes could be produced.
 */
export function serialiseNotesToText(payload: NotesPayload): string {
  const lines: string[] = [];
  const markdown = payload.markdown?.trim() ?? "";

  if (payload.insufficientContext || markdown.length === 0) {
    lines.push(`${payload.subjectName} (${payload.subject}) — CAIE Revision Notes`);
    lines.push(`Paper: ${payload.paperCode} • Topic: ${payload.topicLabel}`);
    lines.push("", payload.notice?.trim() || "No grounded notes available.");
  } else {
    lines.push(markdown);
  }

  if (payload.citations.length > 0) {
    lines.push("", "---", "", "Sources (retrieved CAIE knowledge base):");
    payload.citations.forEach((citation, index) => {
      lines.push(formatCitation(citation, index));
    });
  }

  return lines.join("\n");
}
