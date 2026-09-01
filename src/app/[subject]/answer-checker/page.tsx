import { getSubject } from "@/lib/subjects";

interface AnswerCheckerPageProps {
  params: Promise<{ subject: string }>;
}

export default async function AnswerCheckerPage({
  params,
}: AnswerCheckerPageProps) {
  const { subject } = await params;
  const subjectInfo = getSubject(subject);

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <header className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
          Module 3 — CAIE Strict Answer Checker
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {subjectInfo?.name ?? subject} Answer Checker
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Subject code {subjectInfo?.code ?? "—"}
        </p>
      </header>

      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        Route scaffold ready. Text/handwritten submission tabs, OCR
        verification, and structured CAIE grading are delivered in Phase 6.
      </section>
    </main>
  );
}
