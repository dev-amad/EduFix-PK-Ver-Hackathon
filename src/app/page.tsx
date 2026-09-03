import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MODULES,
  getDefaultModule,
  getVisibleModules,
  type ModuleId,
} from "@/lib/context-guard";
import { SUBJECTS } from "@/lib/subjects";

/**
 * EduFix PK landing page.
 *
 * Replaces the create-next-app boilerplate (which only showed a "Deploy Now"
 * button and "edit page.tsx" placeholder) with the real entry point into the
 * app. Subjects and modules are rendered from the same registries the Navbar
 * and the route guard use (lib/subjects, lib/context-guard) — nothing is
 * hardcoded here (rules.md §2) — and every card links to /{subject}/{module}.
 */

const MODULE_BLURBS: Record<ModuleId, string> = {
  notes: "Revision notes generated from past-paper content for a chosen syllabus topic.",
  "answer-assistant":
    "A structured scaffold — key points and a paragraph outline — for a past-paper question.",
  "answer-checker":
    "Submit an answer, typed or photographed, for mark-scheme feedback, a level and a grade.",
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-14 px-6 py-16 sm:py-20">
        {/* Hero */}
        <header className="flex flex-col items-start gap-5">
          <Badge variant="secondary" className="px-3 py-1 text-xs">
            CAIE O Levels · Pakistan
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            EduFix <span className="text-emerald-700 dark:text-emerald-400">PK</span>
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Past-paper-grounded AI study support for Pakistan Studies, Islamiyat
            and Urdu. Every note, scaffold and grade is retrieved from real CAIE
            past papers and mark schemes — and if the knowledge base can&apos;t
            support an answer, EduFix says so instead of inventing one.
          </p>
        </header>

        {/* Subjects */}
        <section id="subjects" className="flex scroll-mt-8 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Choose a subject
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Three subjects, three modules each. Urdu renders right-to-left.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUBJECTS.map((subject) => (
              <Card key={subject.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg">{subject.name}</CardTitle>
                    {subject.dir === "rtl" ? (
                      <Badge variant="outline">RTL</Badge>
                    ) : null}
                  </div>
                  <CardDescription>Subject code {subject.code}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {getVisibleModules(subject.id).map((module) => {
                    // Req #2 — hide the Note Generator for Urdu; highlight each
                    // subject's default landing module as the primary action.
                    const isPrimary = module.id === getDefaultModule(subject.id);
                    return (
                      <Button
                        key={module.id}
                        asChild
                        variant={isPrimary ? "default" : "outline"}
                        className={
                          isPrimary
                            ? "w-full justify-start bg-emerald-600 text-white hover:bg-emerald-700"
                            : "w-full justify-start"
                        }
                      >
                        <Link href={`/${subject.id}/${module.id}`}>{module.label}</Link>
                      </Button>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Modules explainer */}
        <section className="flex flex-col gap-5">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            What each module does
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {MODULES.map((module) => (
              <div
                key={module.id}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {module.label}
                </h3>
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {MODULE_BLURBS[module.id]}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-6 dark:border-zinc-800">
        <div className="mx-auto w-full max-w-6xl px-6 text-xs text-zinc-500 dark:text-zinc-400">
          EduFix PK — grounded in CAIE past papers and mark schemes. Retrieval is
          subject-isolated; no answer is generated without a source.
        </div>
      </footer>
    </div>
  );
}
