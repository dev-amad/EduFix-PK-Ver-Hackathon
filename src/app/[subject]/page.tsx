import { redirect } from "next/navigation";

import { getDefaultModule } from "@/lib/context-guard";
import { isSubjectId } from "@/lib/subjects";

interface SubjectPageProps {
  params: Promise<{ subject: string }>;
}

/**
 * The bare /{subject} route has no UI of its own — forward it to the subject's
 * default VISIBLE module so selecting a subject never lands on a 404 or on a
 * module hidden for it (Req #2: Urdu skips the Note Generator and lands on the
 * Answering Assistant). Invalid ids are already rejected by the subject layout
 * (notFound) before this runs; the isSubjectId guard keeps the call type-safe.
 */
export default async function SubjectPage({ params }: SubjectPageProps) {
  const { subject } = await params;
  const target = isSubjectId(subject) ? getDefaultModule(subject) : "notes";
  redirect(`/${subject}/${target}`);
}
