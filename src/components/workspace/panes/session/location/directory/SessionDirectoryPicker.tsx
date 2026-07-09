import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, FolderOpen, GitFork } from "lucide-react";
import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SessionLocationIcon } from "../SessionLocationIcon";
import { getRecentDirectories, type RecentDirectory } from "@/lib/session/recentDirectories";
import { resolveSessionLocation } from "../locationDisplay";
import { sessionQueries } from "@/lib/queries";

type SessionDirectoryPickerProps = {
  // Editable pickers follow the MRU when untouched and preserve null as an explicit clear.
  value?: string | null;
  repository?: string;
  gitRoot?: string;
  onValueChange?: (cwd: string | null) => void;
  className?: string;
  isLoading?: boolean;
  useWorktree?: boolean;
  onUseWorktreeChange?: (value: boolean) => void;
};

type EditableSessionDirectoryPickerProps = SessionDirectoryPickerProps & {
  onValueChange: (cwd: string | null) => void;
};

function SessionDirectoryPickerSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("h-6 w-24 shrink-0 rounded-md", className)}
      aria-label="Loading working directory"
    />
  );
}

export function SessionDirectoryPicker(props: SessionDirectoryPickerProps) {
  if (props.isLoading) {
    return <SessionDirectoryPickerSkeleton className={props.className} />;
  }

  if (props.onValueChange) {
    return <EditableSessionDirectoryPicker {...props} onValueChange={props.onValueChange} />;
  }

  const selectedLocation = resolveSessionLocation({
    cwd: props.value ?? undefined,
    repository: props.repository,
    gitRoot: props.gitRoot,
  });

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled
      className={cn(
        "h-6 max-w-52 gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium text-muted-foreground",
        "disabled:pointer-events-none disabled:opacity-70",
        props.className,
      )}
      aria-label={selectedLocation?.description ?? "Working directory unavailable"}
    >
      <SessionLocationIcon kind={selectedLocation?.kind} className="h-3 w-3 shrink-0" />
      <span className="truncate">{selectedLocation?.label ?? "No working directory"}</span>
      <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
    </Button>
  );
}

function EditableSessionDirectoryPicker({
  value,
  repository,
  gitRoot,
  onValueChange,
  className,
  useWorktree,
  onUseWorktreeChange,
}: EditableSessionDirectoryPickerProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const { recentDirectories, isLoading: areRecentDirectoriesLoading } = useRecentDirectories();

  if (value === undefined && areRecentDirectoriesLoading) {
    return <SessionDirectoryPickerSkeleton className={className} />;
  }

  const effectiveValue = value === undefined ? recentDirectories[0]?.cwd : (value ?? undefined);
  const selectedDirectory = recentDirectories.find((directory) => directory.cwd === effectiveValue);
  const directories =
    effectiveValue && !selectedDirectory
      ? [...recentDirectories, { cwd: effectiveValue, repository, gitRoot }]
      : recentDirectories;

  const selectedLocation = resolveSessionLocation({
    repository: selectedDirectory?.repository ?? repository,
    gitRoot: selectedDirectory?.gitRoot ?? gitRoot,
    cwd: selectedDirectory?.cwd ?? effectiveValue,
  });

  function handlePickDirectory() {
    setDropdownOpen(false);
    setBrowserOpen(true);
  }

  function handleBrowserSelect(directory: string) {
    onValueChange(directory);
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 max-w-52 gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium text-muted-foreground",
              "hover:bg-transparent hover:text-foreground",
              className,
            )}
            aria-label={selectedLocation?.description ?? "Select working directory"}
          >
            <SessionLocationIcon kind={selectedLocation?.kind} className="h-3 w-3 shrink-0" />
            <span className="truncate">{selectedLocation?.label ?? "Select directory"}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold">Working Directory</span>
            {onUseWorktreeChange && (
              <button
                type="button"
                disabled={!effectiveValue}
                className={cn(
                  "inline-flex items-center justify-center rounded-sm h-5 w-5 transition-colors",
                  !effectiveValue
                    ? "text-muted-foreground/30 cursor-not-allowed"
                    : useWorktree
                      ? "text-foreground bg-accent"
                      : "text-muted-foreground/50 hover:text-muted-foreground",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onUseWorktreeChange(!useWorktree);
                }}
                aria-label="Use a worktree"
              >
                <GitFork className="h-3 w-3" />
              </button>
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-[min(20rem,40vh)] overflow-y-auto">
            {directories.length > 0 ? (
              directories.map((directory) => {
                const location = resolveSessionLocation(directory);
                if (!location) return null;
                const isSelected = directory.cwd === effectiveValue;

                return (
                  <DropdownMenuItem
                    key={directory.cwd}
                    className="gap-2 py-1.5"
                    onSelect={() => onValueChange(isSelected ? null : directory.cwd)}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", !isSelected && "opacity-0")} />
                    <SessionLocationIcon kind={location.kind} className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-xs">{location.label}</span>
                      <span className="truncate text-2xs text-muted-foreground">
                        {directory.cwd}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })
            ) : (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                No recent directories
              </DropdownMenuItem>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-xs"
            onSelect={(event) => {
              event.preventDefault();
              handlePickDirectory();
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose Directory...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DirectoryBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={handleBrowserSelect}
        initialPath={effectiveValue}
      />
    </>
  );
}

function useRecentDirectories(): {
  recentDirectories: RecentDirectory[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    ...sessionQueries.state(),
    select: (state) => getRecentDirectories(state.sessions),
  });

  return {
    recentDirectories: data ?? [],
    isLoading,
  };
}
