import { redirect } from "next/navigation";

import { NotesStudio } from "@/components/notes/NotesStudio";
import { getDefaultModule, isModuleVisible } from "@/lib/context-guard";
import { getEffectiveTaxonomy } from "@/lib/kb/subtopics";
import { getSubject, isSubjectId } from "@/lib/subjects";

interface NotesPageProps {
  params: Promise<{ subject: string }>;
}

export default async function NotesPage({ params }: NotesPageProps) {
  const { subject } = await params;
  // Req #2 — the Note Generator is hidden for Urdu; redirect direct /urdu/notes
  // hits to Urdu's default visible module so the feature is fully unreachable.
  if (isSubjectId(subject) && !isModuleVisible(subject, "notes")) {
    redirect(`/${subject}/${getDefaultModule(subject)}`);
  }
  const subjectInfo = getSubject(subject);
  const taxonomy = subjectInfo ? getEffectiveTaxonomy(subjectInfo.id) : undefined;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-8">
      <header className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
          Module 1 — AI Notes Generator
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {subjectInfo?.name ?? subject} Notes
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Subject code {subjectInfo?.code ?? "—"}
        </p>
      </header>

      {subjectInfo && taxonomy ? (
        <NotesStudio
          subjectId={subjectInfo.id}
          subjectName={subjectInfo.name}
          subjectCode={subjectInfo.code}
          taxonomy={taxonomy}
        />
      ) : (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          No syllabus taxonomy is available for this subject yet. Run{" "}
          <code className="font-mono">npx tsx scripts/derive-topics.ts</code>{" "}
          to regenerate it from the syllabus source files.
        </section>
      )}
    </main>
  );
}
