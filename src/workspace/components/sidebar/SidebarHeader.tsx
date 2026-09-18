import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { modelQueries } from "@sessions/queries";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import { ChevronDown, Clock3, FileText, Filter, Hash, Shapes, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { NewSessionButton, type SidebarCreateOptions } from "./SidebarActions";

export function SidebarHeader({
  leadingSlot,
  filter,
  onFilterChange,
  sessionCount,
  onCreateSession,
  onCreateAutomation,
  onCreateChannel,
}: {
  /** The row's first item: an action that survives collapse, or a spacer holding its place. */
  leadingSlot?: ReactNode;
  filter: string;
  onFilterChange: (value: string) => void;
  sessionCount: number;
  onCreateSession: (options?: SidebarCreateOptions) => void;
  onCreateAutomation: () => void;
  onCreateChannel: () => void;
}) {
  const showExternalSessions = useWorkspaceSelector(
    (workspace) => workspace.settings.showExternalSessions,
  );
  const hiddenProviders = useWorkspaceSelector(
    (workspace) => workspace.settings.hiddenSessionProviders,
  );
  const updateSetting = useUpdateWorkspaceSetting();
  const { data: providers = [] } = useQuery({
    ...modelQueries.list(),
    select: (models) => [
      ...new Map(models.map((model) => [model.provider, model.providerName ?? model.provider])),
    ],
  });

  function createArtifactDraft(path: string, content = "") {
    onCreateSession({ artifact: { path, content } });
  }

  return (
    <div
      className="pt-0 md:pt-3 pb-3 px-2.5 border-b flex items-center gap-2"
      suppressHydrationWarning
    >
      {leadingSlot}
      <div className="relative flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className={cn(
                  "absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 hover:text-foreground",
                  hiddenProviders.length || !showExternalSessions
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
                aria-label="Filter sessions"
                suppressHydrationWarning
              />
            }
          >
            <Filter className="h-4 w-4" />
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuCheckboxItem
              checked={showExternalSessions}
              onCheckedChange={(checked) => updateSetting("showExternalSessions", checked)}
            >
              Show external sessions
            </DropdownMenuCheckboxItem>
            {providers.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Providers</DropdownMenuLabel>
                  {providers.map(([id, name]) => (
                    <DropdownMenuCheckboxItem
                      key={id}
                      checked={!hiddenProviders.includes(id)}
                      onCheckedChange={(checked) =>
                        updateSetting(
                          "hiddenSessionProviders",
                          checked
                            ? hiddenProviders.filter((provider) => provider !== id)
                            : [...hiddenProviders, id],
                        )
                      }
                    >
                      {name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={`Filter sessions (${sessionCount})`}
          className={cn("h-8 pl-12", filter ? "pr-8" : "pr-2")}
        />
        {filter && (
          <button
            onClick={() => onFilterChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear filter"
            suppressHydrationWarning
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex">
        <NewSessionButton onCreateSession={onCreateSession} className="size-7 rounded-r-none" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="accent"
                className="h-7 w-5 rounded-l-none border-l border-background"
                aria-label="Create options"
                suppressHydrationWarning
              />
            }
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => createArtifactDraft("document.md")}>
              <FileText />
              New document
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                createArtifactDraft(
                  "diagram.svg",
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"></svg>\n',
                )
              }
            >
              <Shapes />
              New whiteboard
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCreateAutomation}>
              <Clock3 />
              Create automation
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateChannel}>
              <Hash />
              Create channel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
