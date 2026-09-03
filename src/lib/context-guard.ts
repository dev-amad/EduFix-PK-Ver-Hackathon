/**
 * Route context guard — enforces the `/[subject]/[module]` boundary defined
 * in rules.md §2. Pages derive their context from URL params via the subject
 * layout; API routes must resolve and assert their context here before any
 * KB query so one subject's content can never leak into another route.
 */

import {
  ALLOWED_SUBJECT_IDS,
  assertSubjectId,
  isSubjectId,
  type SubjectId,
} from "@/lib/subjects";

export const MODULES = [
  { id: "notes", label: "Notes" },
  { id: "answer-assistant", label: "Answering Assistant" },
  { id: "answer-checker", label: "Answer Checker" },
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export const ALLOWED_MODULE_IDS = MODULES.map(
  (module) => module.id
) as readonly ModuleId[];

export interface RouteContext {
  subject: SubjectId;
  module: ModuleId;
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && MODULES.some((m) => m.id === value);
}

export function assertModuleId(value: string): ModuleId {
  if (!isModuleId(value)) {
    throw new Error(
      `Invalid module "${value}". Allowed modules: ${ALLOWED_MODULE_IDS.join(", ")}.`
    );
  }
  return value;
}

/**
 * Refactor (Req #2) — per-subject module visibility.
 *
 * The Note Generator is HIDDEN for Urdu (subject id "urdu", CAIE 3247/3248):
 * Urdu study here is directed-writing / comprehension based, so the product
 * surfaces only the Answering Assistant and Answer Checker for it. Islamiyat
 * (2058) and Pakistan Studies (2059) keep all three modules. Keyed by SubjectId
 * so it covers every Urdu paper code routed through the "urdu" subject.
 */
const NOTES_HIDDEN_SUBJECTS = new Set<SubjectId>(["urdu"]);

/** Whether a module tab/route should be shown for a given subject. */
export function isModuleVisible(subject: SubjectId, module: ModuleId): boolean {
  return !(module === "notes" && NOTES_HIDDEN_SUBJECTS.has(subject));
}

/** The modules a subject exposes, in canonical order. */
export function getVisibleModules(subject: SubjectId) {
  return MODULES.filter((module) => isModuleVisible(subject, module.id));
}

/**
 * The landing module for a subject — its first visible module. Urdu (notes
 * hidden) lands on the Answering Assistant; every other subject lands on Notes.
 */
export function getDefaultModule(subject: SubjectId): ModuleId {
  return getVisibleModules(subject)[0]?.id ?? "notes";
}

/**
 * Non-throwing validation of raw route params. Returns null when either
 * segment falls outside the allowed subject/module sets.
 */
export function resolveRouteContext(raw: {
  subject?: unknown;
  module?: unknown;
}): RouteContext | null {
  if (!isSubjectId(raw.subject) || !isModuleId(raw.module)) {
    return null;
  }
  return { subject: raw.subject, module: raw.module };
}

/**
 * Throwing variant for API routes: guarantees the returned context is typed
 * and safe to forward into RAG queries.
 */
export function assertRouteContext(raw: {
  subject?: unknown;
  module?: unknown;
}): RouteContext {
  const subject = assertSubjectId(raw.subject == null ? "" : String(raw.subject));
  const moduleId = assertModuleId(raw.module == null ? "" : String(raw.module));
  return { subject, module: moduleId };
}

/**
 * Ensures a candidate subject_id (e.g. from a request body) agrees with the
 * route's subject scope. A request hitting /pak-studies/* that references
 * another subject is rejected before it can reach the knowledge base.
 */
export function assertSubjectMatches(
  routeSubject: string,
  candidate: unknown
): SubjectId {
  const subject = assertSubjectId(routeSubject);
  if (!isSubjectId(candidate) || candidate !== subject) {
    throw new Error(
      `Subject context mismatch: route is scoped to "${subject}" (allowed: ${ALLOWED_SUBJECT_IDS.join(", ")}), but the request references "${String(candidate)}".`
    );
  }
  return subject;
}
