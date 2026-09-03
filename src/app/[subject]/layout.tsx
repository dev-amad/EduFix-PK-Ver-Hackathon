import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/nav/Navbar";
import { getSubjectLang, isSubjectId } from "@/lib/subjects";

interface SubjectLayoutProps {
  children: ReactNode;
  params: Promise<{ subject: string }>;
}

export default async function SubjectLayout({
  children,
  params,
}: SubjectLayoutProps) {
  const { subject } = await params;

  if (!isSubjectId(subject)) {
    notFound();
  }

  // Refactor (Req #1): the app chrome (navbar, grids, cards) stays strictly LTR.
  // We NO LONGER flip a global dir="rtl" on Urdu — that inverted the navbar and
  // every nested grid. Instead we scope ONLY the language (lang="ur") to the
  // module content, which drives the Nastaliq font + a11y without changing
  // layout direction. Per-node RTL for Urdu script is handled by the dir="auto"
  // attributes already on every text/textarea component (rules.md §4).
  const lang = getSubjectLang(subject);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar />
      <div lang={lang} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
