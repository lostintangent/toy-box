import { ChevronDown, X, PanelLeftClose, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SessionSourceFilter = "toy-box" | "all";

export interface SidebarHeaderProps {
  filter: string;
  onFilterChange: (value: string) => void;
  sourceFilter: SessionSourceFilter;
  onSourceFilterChange: (value: SessionSourceFilter) => void;
  filteredSessionsCount: number;
  onCreateSession: (e?: React.MouseEvent) => void;
  onCollapse?: () => void;
}

export function SidebarHeader({
  filter,
  onFilterChange,
  sourceFilter,
  onSourceFilterChange,
  filteredSessionsCount,
  onCreateSession,
  onCollapse,
}: SidebarHeaderProps) {
  return (
    <div
      className="px-3 pt-0 md:pt-3 pb-3 border-b flex items-center gap-2"
      suppressHydrationWarning
    >
      {onCollapse && (
        <button
          onClick={onCollapse}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Collapse sidebar"
          suppressHydrationWarning
        >
          <PanelLeftClose className="h-5 w-5" />
        </button>
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
            <DropdownMenuItem onClick={() => onSourceFilterChange("toy-box")}>
              Toy Box
              {sourceFilter === "toy-box" && <span className="ml-auto text-primary">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSourceFilterChange("all")}>
              All
              {sourceFilter === "all" && <span className="ml-auto text-primary">✓</span>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={`Filter sessions (${filteredSessionsCount})`}
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
      <Button
        size="sm"
        onClick={onCreateSession}
        className="bg-green-600 text-white hover:bg-green-700"
        suppressHydrationWarning
      >
        New
      </Button>
    </div>
  );
}
