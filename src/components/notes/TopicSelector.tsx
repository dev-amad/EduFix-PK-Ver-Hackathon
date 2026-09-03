"use client";

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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getTopicOptions,
  type SubjectTaxonomy,
  type TopicOption,
} from "@/lib/kb/topics";

/** Render a paper option label, prefixing bare numbers with "Paper". */
function paperLabel(paper: { id: string; title: string }) {
  return paper.title.toLowerCase().startsWith("paper")
    ? paper.title
    : `Paper ${paper.id} — ${paper.title}`;
}

interface OptionGroup {
  key: string;
  label?: string;
  options: TopicOption[];
}

/**
 * Bucket topic options by their optional `group` (sub-topic category),
 * preserving first-appearance order. Options without a group land in a single
 * "" bucket rendered without a header.
 */
function groupOptions(options: TopicOption[]): { groups: OptionGroup[]; hasGroups: boolean } {
  const groups: OptionGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const option of options) {
    const key = option.group ?? "";
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, label: option.group, options: [] });
    }
    groups[idx].options.push(option);
  }
  return { groups, hasGroups: groups.some((g) => Boolean(g.label)) };
}

interface TopicSelectorProps {
  subjectName: string;
  subjectCode: string;
  taxonomy: SubjectTaxonomy;
  paperId: string;
  topicId: string;
  isGenerating: boolean;
  onPaperChange: (paperId: string) => void;
  onTopicChange: (topicId: string) => void;
  onGenerate: () => void;
}

/**
 * Topic Selector — 3-tier hierarchy: [Subject (route)] -> [Paper / Section] ->
 * [Sub-Topic]. For Islamiyat and Pakistan Studies the sub-topics are the
 * granular product-defined map (grouped by category); for other subjects they
 * are the syllabus-derived topics. There are NO content toggles: the notes
 * always follow the CAIE AO1/AO2 structure, injected by the subject route.
 */
export function TopicSelector({
  subjectName,
  subjectCode,
  taxonomy,
  paperId,
  topicId,
  isGenerating,
  onPaperChange,
  onTopicChange,
  onGenerate,
}: TopicSelectorProps) {
  const topicOptions = getTopicOptions(taxonomy, paperId);
  const { groups, hasGroups } = groupOptions(topicOptions);
  const selectedPaper = taxonomy.papers.find((paper) => paper.id === paperId);
  const selectedTopic = topicOptions.find((topic) => topic.id === topicId);
  const canGenerate = topicId.length > 0 && !isGenerating;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Selector</CardTitle>
        <CardDescription>
          Choose the syllabus scope for your revision notes — paper/section, then
          sub-topic. Notes are grounded strictly in the official {subjectName}{" "}
          ({subjectCode}) knowledge base.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Subject</span>
            <Badge
              variant="outline"
              className="h-9 w-fit justify-start gap-1.5 px-2.5 text-sm font-normal"
            >
              {subjectName}
              <span className="text-muted-foreground">({subjectCode})</span>
            </Badge>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="paper-select" className="text-sm font-medium">
              Paper / Section
            </Label>
            <Select value={paperId} onValueChange={onPaperChange}>
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
              Sub-Topic
            </Label>
            <Select
              value={topicId}
              onValueChange={onTopicChange}
              disabled={topicOptions.length === 0}
            >
              <SelectTrigger id="topic-select" className="w-full">
                <SelectValue placeholder="Select a sub-topic" />
              </SelectTrigger>
              <SelectContent>
                {hasGroups
                  ? groups.map((group) => (
                      <SelectGroup key={group.key || "__ungrouped"}>
                        {group.label ? (
                          <SelectLabel>{group.label}</SelectLabel>
                        ) : null}
                        {group.options.map((topic) => (
                          <SelectItem key={topic.id} value={topic.id}>
                            {topic.title}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))
                  : topicOptions.map((topic) => (
                      <SelectItem key={topic.id} value={topic.id}>
                        {topic.title}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Selection: </span>
            {selectedPaper ? paperLabel(selectedPaper) : "All papers"}
            {" • "}
            {selectedTopic?.title ?? "No sub-topic selected"}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isGenerating ? (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              ) : (
                <SparklesIcon className="size-4" />
              )}
              {isGenerating ? "Generating…" : "Generate Notes"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Notes follow the CAIE AO1/AO2 structure — no toggles required.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
