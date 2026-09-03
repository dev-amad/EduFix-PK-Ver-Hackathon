/**
 * Subject registry — the single source of truth for allowed [subject] routes.
 *
 * rules.md constrains [subject] to pak-studies / islamiyat / urdu. Every
 * route, RAG query, and nav component should resolve subjects through this
 * registry instead of hardcoding IDs.
 */

export type TextDirection = "ltr" | "rtl";

export const SUBJECTS = [
  { id: "pak-studies", name: "Pakistan Studies", code: "2059", dir: "ltr", lang: "en" },
  { id: "islamiyat", name: "Islamiyat", code: "2058", dir: "ltr", lang: "en" },
  { id: "urdu", name: "Urdu", code: "3248", dir: "rtl", lang: "ur" },
] as const;

export type SubjectId = (typeof SUBJECTS)[number]["id"];

export const ALLOWED_SUBJECT_IDS = SUBJECTS.map(
  (subject) => subject.id
) as readonly SubjectId[];

export function isSubjectId(value: unknown): value is SubjectId {
  return typeof value === "string" && SUBJECTS.some((s) => s.id === value);
}

export function assertSubjectId(value: string): SubjectId {
  if (!isSubjectId(value)) {
    throw new Error(
      `Invalid subject_id "${value}". Allowed subjects: ${ALLOWED_SUBJECT_IDS.join(", ")}.`
    );
  }
  return value;
}

export function getSubject(id: string) {
  return SUBJECTS.find((s) => s.id === id);
}

/**
 * Text direction for a subject's `/[subject]/*` routes. Urdu (3248) is the only
 * right-to-left subject; unknown ids fall back to LTR (rules.md §1).
 */
export function getSubjectDir(id: string): TextDirection {
  return getSubject(id)?.dir ?? "ltr";
}

/** BCP-47 language tag for a subject's rendered content (Urdu → "ur"). */
export function getSubjectLang(id: string): string {
  return getSubject(id)?.lang ?? "en";
}
