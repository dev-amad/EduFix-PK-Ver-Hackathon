import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Navbar } from "@/components/nav/Navbar";
import { isSubjectId } from "@/lib/subjects";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar />
      {children}
    </div>
  );
}
