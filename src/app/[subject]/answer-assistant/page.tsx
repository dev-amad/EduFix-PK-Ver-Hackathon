import { AnswerAssistantStudio } from "@/components/answer-assistant/AnswerAssistantStudio";
import { getSubject } from "@/lib/subjects";

interface AnswerAssistantPageProps {
  params: Promise<{ subject: string }>;
}

export default async function AnswerAssistantPage({
  params,
}: AnswerAssistantPageProps) {
  const { subject } = await params;
  const subjectInfo = getSubject(subject);

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <header className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
          Module 2 — Guided Answering Agent
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {subjectInfo?.name ?? subject} Answering Assistant
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Subject code {subjectInfo?.code ?? "—"}
        </p>
      </header>

      {subjectInfo ? (
        <AnswerAssistantStudio key={subjectInfo.id} subjectId={subjectInfo.id} />
      ) : (
        <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Unknown subject &ldquo;{subject}&rdquo;. Choose Pakistan Studies,
          Islamiyat or Urdu from the navigation.
        </section>
      )}
    </main>
  );
}
