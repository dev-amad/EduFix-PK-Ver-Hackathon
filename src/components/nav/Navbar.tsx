"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODULES, isModuleId, type ModuleId } from "@/lib/context-guard";
import { SUBJECTS, isSubjectId, type SubjectId } from "@/lib/subjects";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const [, subjectSegment, moduleSegment] = pathname.split("/");

  const subjectId: SubjectId = isSubjectId(subjectSegment)
    ? subjectSegment
    : SUBJECTS[0].id;
  const moduleId: ModuleId = isModuleId(moduleSegment) ? moduleSegment : "notes";
  const subject = SUBJECTS.find((option) => option.id === subjectId) ?? SUBJECTS[0];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link
          href={`/${subject.id}/${moduleId}`}
          className="text-base font-semibold tracking-tight text-emerald-700 dark:text-emerald-400"
        >
          EduFix PK
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Switch subject"
            className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            <span>{subject.name}</span>
            <span className="text-xs text-muted-foreground">{subject.code}</span>
            <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>Subjects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SUBJECTS.map((option) => (
              <DropdownMenuItem key={option.id} asChild>
                <Link
                  href={`/${option.id}/${moduleId}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex flex-col">
                    <span>{option.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Code {option.code}
                    </span>
                  </span>
                  {option.id === subject.id ? (
                    <CheckIcon className="size-4 text-emerald-600" />
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <nav
          aria-label="Modules"
          className="ml-auto flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1"
        >
          {MODULES.map((module) => {
            const active = module.id === moduleId;
            return (
              <Link
                key={module.id}
                href={`/${subject.id}/${module.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-background hover:text-foreground"
                )}
              >
                {module.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
