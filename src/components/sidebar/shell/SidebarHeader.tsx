import { ChevronDown, X, PanelLeftClose, Filter, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SidebarHeader({
  filter,
  onFilterChange,
  showExternalSessions,
  onShowExternalSessionsChange,
  sessionCount,
  onCreateSession,
  onCollapse,
}: {
  filter: string;
  onFilterChange: (value: string) => void;
  showExternalSessions: boolean;
  onShowExternalSessionsChange: (value: boolean) => void;
  sessionCount: number;
  onCreateSession: (addToWorkspace: boolean) => void;
  onCollapse?: () => void;
}) {
  return (
    <div
      className="px-3 pt-0 md:pt-3 pb-3 border-b flex items-center gap-2"
      suppressHydrationWarning
    >
      {onCollapse && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCollapse}
              aria-label="Collapse sidebar"
              suppressHydrationWarning
            >
              <PanelLeftClose className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>Collapse sidebar</TooltipContent>
        </Tooltip>
      )}
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
          className={cn("pl-12", filter ? "pr-8" : "pr-2")}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="accent"
            onClick={(event) => onCreateSession(event.metaKey || event.ctrlKey)}
            aria-label="New session"
            suppressHydrationWarning
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>New session</TooltipContent>
      </Tooltip>
    </div>
  );
}
