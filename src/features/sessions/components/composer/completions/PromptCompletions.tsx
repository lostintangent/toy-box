// `/` completes skills only at the prompt's start; `@` completes working-directory paths.
// Both insert plain text, so the draft and message schemas stay unchanged.

import type { RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer/debouncer";
import { FilePenLine, FileText } from "lucide-react";
import { getPathBasename, getPathDirname } from "@files/model/paths";
import { fileQueries } from "@files/queries";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { Button } from "@/shared/ui/button";
import { MetadataBadge } from "@/shared/ui/metadata-badge";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { useCompletions } from "@/shared/composers/completions/useCompletions";
import { cn } from "@/shared/utils";
import type { SessionSkill } from "../../../model";
import { fileCompletionSource, skillCompletionSource } from "./completionSources";

type PromptSuggestion = { kind: "skill"; skill: SessionSkill } | { kind: "file"; path: string };

type PromptCompletions = ReturnType<typeof usePromptCompletions>;

export function usePromptCompletions({
  prompt,
  onPromptChange,
  textareaRef,
  skills = [],
  directory,
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  skills?: SessionSkill[];
  /** Working directory whose files `@` can reference. */
  directory?: string;
}) {
  const completions = useCompletions({
    value: prompt,
    onValueChange: onPromptChange,
    textareaRef,
    sources: [skillCompletionSource, fileCompletionSource],
  });
  const { active } = completions;
  const referenceQuery = active?.source === fileCompletionSource.id ? active.query : undefined;
  const [searchQuery] = useDebouncedValue(referenceQuery ?? "", { wait: 150 });
  const fileSearch = useQuery({
    ...fileQueries.search(directory ?? "", searchQuery),
    enabled: referenceQuery !== undefined && directory !== undefined,
  });
  const workspaceFiles =
    directory !== undefined && referenceQuery === searchQuery ? (fileSearch.data ?? []) : [];

  const suggestions: PromptSuggestion[] =
    active?.source === skillCompletionSource.id
      ? skills
          .filter(({ name, description }) =>
            [name, description].some((text) =>
              text.toLowerCase().includes(active.query.toLowerCase()),
            ),
          )
          .map((skill) => ({ kind: "skill", skill }))
      : referenceQuery !== undefined
        ? workspaceFiles.map((path) => ({ kind: "file", path }))
        : [];

  const select = (suggestion: PromptSuggestion) =>
    completions.insert(
      suggestion.kind === "skill" ? `/${suggestion.skill.name}` : `@${suggestion.path}`,
    );

  return {
    ...completions,
    suggestions,
    select,
    /** Returns true when the completion consumed the key. */
    handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) =>
      completions.handleKeyDown(event, suggestions.length, (index) => select(suggestions[index]!)),
  };
}

export function PromptCompletionMenu({
  completions,
  showGlobalSkillBadges,
}: {
  completions: PromptCompletions;
  showGlobalSkillBadges: boolean;
}) {
  const { suggestions, activeIndex, setActiveIndex, select } = completions;
  if (suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Prompt completions"
      className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg @sm:w-96"
    >
      {suggestions.map((suggestion, index) => (
        <div
          key={suggestion.kind === "skill" ? suggestion.skill.name : suggestion.path}
          ref={
            index === activeIndex
              ? (element) => element?.scrollIntoView({ block: "nearest" })
              : undefined
          }
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            select(suggestion);
          }}
          className={cn(
            "flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
            index === activeIndex && "bg-accent/50 text-accent-foreground",
          )}
        >
          {suggestion.kind === "skill" ? (
            <SkillSuggestion skill={suggestion.skill} showGlobalBadge={showGlobalSkillBadges} />
          ) : (
            <FileSuggestion path={suggestion.path} />
          )}
        </div>
      ))}
    </div>
  );
}

function SkillSuggestion({
  skill,
  showGlobalBadge,
}: {
  skill: SessionSkill;
  showGlobalBadge: boolean;
}) {
  const { openFile } = useWorkspaceSurface();
  const path = skill.path;

  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">/{skill.name}</span>
        {skill.description && (
          <ScrollableFade className="whitespace-nowrap text-xs opacity-70">
            <span className="shrink-0">{skill.description}</span>
          </ScrollableFade>
        )}
      </span>
      {showGlobalBadge && skill.type === "global" && <MetadataBadge>Global</MetadataBadge>}
      {path && openFile && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Open ${skill.name} skill file`}
          title="Open SKILL.md"
          className="text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openFile(path);
          }}
        >
          <FilePenLine aria-hidden="true" />
        </Button>
      )}
    </>
  );
}

function FileSuggestion({ path }: { path: string }) {
  const directory = getPathDirname(path);
  return (
    <>
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">
        {getPathBasename(path)}
        {directory !== "." && <span className="ms-1.5 text-xs opacity-70">{directory}</span>}
      </span>
    </>
  );
}
