"use client";

import { useMemo, useState } from "react";
import { SparklesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  getTopicOptions,
  type SubjectTaxonomy,
} from "@/lib/kb/topics";

export const NOTE_OPTIONS = [
  {
    id: "timeline",
    label: "Timeline",
    description: "Chronological rundown of key events",
  },
  {
    id: "quranic-verses",
    label: "Quranic Verses",
    description: "Relevant verses and references",
  },
  {
    id: "vocabulary",
    label: "Vocabulary",
    description: "Key terms and definitions",
  },
  {
    id: "examiner-pitfalls",
    label: "Examiner Pitfalls",
    description: "Common mistakes examiners flag",
  },
] as const;

export type NoteOptionId = (typeof NOTE_OPTIONS)[number]["id"];

function paperLabel(paper: { id: string; title: string }) {
  return paper.title.toLowerCase().startsWith("paper")
    ? paper.title
    : `Paper ${paper.id} — ${paper.title}`;
}

interface NotesConfiguratorProps {
  subjectName: string;
  subjectCode: string;
  taxonomy: SubjectTaxonomy;
}

export function NotesConfigurator({
  subjectName,
  subjectCode,
  taxonomy,
}: NotesConfiguratorProps) {
  const [paperId, setPaperId] = useState<string>("all");
  const [topicId, setTopicId] = useState<string>("all");
  const [enabledOptions, setEnabledOptions] = useState<
    Record<NoteOptionId, boolean>
  >({
    timeline: false,
    "quranic-verses": false,
    vocabulary: false,
    "examiner-pitfalls": false,
  });

  const topicOptions = useMemo(
    () => getTopicOptions(taxonomy, paperId),
    [taxonomy, paperId]
  );

  const selectedPaper = taxonomy.papers.find((paper) => paper.id === paperId);
  const selectedTopic = topicOptions.find((topic) => topic.id === topicId);
  const activeOptionLabels = NOTE_OPTIONS.filter(
    (option) => enabledOptions[option.id]
  ).map((option) => option.label);

  const summaryParts = [
    selectedPaper ? paperLabel(selectedPaper) : "All papers",
    selectedTopic?.title ?? "All topics",
  ];

  function toggleOption(id: NoteOptionId, value: boolean) {
    setEnabledOptions((previous) => ({ ...previous, [id]: value }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Selector</CardTitle>
        <CardDescription>
          Choose the syllabus scope for your revision notes. Topics are
          derived from the official {subjectName} ({subjectCode}) syllabus.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Subject</span>
            <Badge variant="outline" className="h-8 w-fit justify-start gap-1.5 px-2.5 text-sm font-normal">
              {subjectName}
              <span className="text-muted-foreground">({subjectCode})</span>
            </Badge>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="paper-select" className="text-sm font-medium">
              Paper
            </Label>
            <Select
              value={paperId}
              onValueChange={(value) => {
                setPaperId(value);
                setTopicId("all");
              }}
            >
              <SelectTrigger id="paper-select" className="w-full">
                <SelectValue placeholder="Select a paper" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All papers</SelectItem>
                {taxonomy.papers.map((paper) => (
                  <SelectItem key={paper.id} value={paper.id}>
                    {paperLabel(paper)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="topic-select" className="text-sm font-medium">
              Topic
            </Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger id="topic-select" className="w-full">
                <SelectValue placeholder="Select a topic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics</SelectItem>
                {topicOptions.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">Note options</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {NOTE_OPTIONS.map((option) => (
              <div
                key={option.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`option-${option.id}`} className="text-sm font-medium">
                    {option.label}
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
                <Switch
                  id={`option-${option.id}`}
                  checked={enabledOptions[option.id]}
                  onCheckedChange={(value) => toggleOption(option.id, value)}
                  aria-label={`Include ${option.label.toLowerCase()} in notes`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4 text-sm">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Selection: </span>
            {summaryParts.join(" • ")}
            {activeOptionLabels.length > 0
              ? ` • Extras: ${activeOptionLabels.join(", ")}`
              : " • No extras selected"}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button disabled className="bg-emerald-600 text-white hover:bg-emerald-700">
              <SparklesIcon className="size-4" />
              Generate Notes
            </Button>
            <p className="text-xs text-muted-foreground">
              KB-grounded streaming generation is delivered in Phase 4.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
