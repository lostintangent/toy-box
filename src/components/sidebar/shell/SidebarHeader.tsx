import type { ReactNode } from "react";
import { ChevronDown, FileText, Filter, Shapes, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewSessionButton, type SidebarCreateOptions } from "./SidebarActions";

export function SidebarHeader({
  leadingSlot,
  filter,
  onFilterChange,
  showExternalSessions,
  onShowExternalSessionsChange,
  sessionCount,
  onCreateSession,
}: {
  /** The row's first item: an action that survives collapse, or a spacer holding its place. */
  leadingSlot?: ReactNode;
  filter: string;
  onFilterChange: (value: string) => void;
  showExternalSessions: boolean;
  onShowExternalSessionsChange: (value: boolean) => void;
  sessionCount: number;
  onCreateSession: (options?: SidebarCreateOptions) => void;
}) {
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
          <DropdownMenuTrigger asChild>
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Filter source"
              suppressHydrationWarning
            >
              <Filter className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuCheckboxItem
              checked={showExternalSessions}
              onCheckedChange={(checked) => onShowExternalSessionsChange(checked === true)}
            >
              Show external sessions
            </DropdownMenuCheckboxItem>
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
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="accent"
              className="h-7 w-5 rounded-l-none border-l border-background"
              aria-label="New session options"
              suppressHydrationWarning
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => createArtifactDraft("document.md")}>
              <FileText />
              New document
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                createArtifactDraft(
                  "diagram.svg",
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"></svg>\n',
                )
              }
            >
              <Shapes />
              New diagram
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
