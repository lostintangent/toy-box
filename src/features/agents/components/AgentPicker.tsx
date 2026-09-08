import { useState } from "react";
import { FilePenLine, UserPlus, Users } from "lucide-react";
import { AgentAvatar } from "@agents/components/AgentAvatar";
import { Button } from "@/shared/components/ui/button";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { cn } from "@/shared/utils";
import { AgentEditor } from "./AgentEditor";
import type { AgentPickerSuggestion } from "./agentPickerSuggestions";

export function AgentPicker({
  suggestions,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  error,
}: {
  suggestions: readonly AgentPickerSuggestion[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (suggestion: AgentPickerSuggestion) => void;
  error?: Error | null;
}) {
  const [editingAgentId, setEditingAgentId] = useState<string>();

  if (suggestions.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-30 mb-2 w-full rounded-xl border bg-popover p-3 text-xs text-muted-foreground shadow-lg sm:w-96">
        Type a name to create an Agent.
      </div>
    );
  }

  return (
    <>
      <div
        role="listbox"
        aria-label="Mention an agent"
        className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-lg sm:w-96"
      >
        {suggestions.map((suggestion, index) => {
          const showGroup = index === 0 || suggestions[index - 1]?.group !== suggestion.group;
          return (
            <div key={`${suggestion.group}:${suggestion.handle}`}>
              {showGroup && (
                <div className="px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {suggestion.group}
                </div>
              )}
              <div
                onMouseEnter={() => onActiveIndexChange(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2",
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {suggestion.kind === "everyone" ? (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                      <Users className="size-3.5" />
                    </span>
                  ) : suggestion.kind === "create" ? (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserPlus className="size-3.5" />
                    </span>
                  ) : (
                    <AgentAvatar
                      name={suggestion.name}
                      avatar={suggestion.avatar}
                      className="size-7"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{suggestion.name}</span>
                    <ScrollableFade className="whitespace-nowrap text-2xs text-muted-foreground">
                      <span className="shrink-0">{suggestion.description}</span>
                    </ScrollableFade>
                  </span>
                </button>
                {suggestion.agentId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${suggestion.name}`}
                    title="Edit agent"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setEditingAgentId(suggestion.agentId)}
                  >
                    <FilePenLine className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {error && (
          <p role="alert" className="border-t px-2 py-2 text-2xs text-destructive">
            {error.message}
          </p>
        )}
      </div>
      {editingAgentId && (
        <AgentEditor agentId={editingAgentId} onClose={() => setEditingAgentId(undefined)} />
      )}
    </>
  );
}
