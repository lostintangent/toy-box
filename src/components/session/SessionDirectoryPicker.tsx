import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, FolderClosed, FolderOpen, GitBranch, GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  findSessionDirectoryOption,
  normalizeSessionDirectoryOptions,
  type SessionDirectoryOption,
} from "./sessionDirectoryOptions";
import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog";
import { resolveSessionLocation } from "./sessionLocation";
import { cn } from "@/lib/utils";

type SessionDirectoryPickerProps = {
  value?: string;
  repository?: string;
  gitRoot?: string;
  options: SessionDirectoryOption[];
  onValueChange?: (cwd: string | undefined) => void;
  disabled?: boolean;
  className?: string;
  useWorktree?: boolean;
  onUseWorktreeChange?: (value: boolean) => void;
};

export function SessionDirectoryPicker({
  value,
  repository,
  gitRoot,
  options,
  onValueChange,
  disabled = false,
  className,
  useWorktree,
  onUseWorktreeChange,
}: SessionDirectoryPickerProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const normalizedOptions = useMemo(
    () =>
      normalizeSessionDirectoryOptions(
        options,
        value ? { cwd: value, repository, gitRoot } : undefined,
      ),
    [options, repository, gitRoot, value],
  );

  const selectedOption = useMemo(
    () => findSessionDirectoryOption(normalizedOptions, value),
    [normalizedOptions, value],
  );
  const selectedLocation = resolveSessionLocation({
    repository: selectedOption?.repository ?? repository,
    gitRoot: selectedOption?.gitRoot ?? gitRoot,
    cwd: selectedOption?.cwd ?? value,
  });

  const canChangeDirectory = Boolean(onValueChange) && !disabled;

  const handlePickDirectory = useCallback(() => {
    if (canChangeDirectory) {
      setBrowserOpen(true);
    }
  }, [canChangeDirectory]);

  const handleBrowserSelect = useCallback(
    (directory: string) => {
      onValueChange?.(directory);
      setDropdownOpen(false);
    },
    [onValueChange],
  );

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 max-w-[13rem] gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium text-muted-foreground",
              "hover:bg-transparent hover:text-foreground disabled:pointer-events-none disabled:opacity-70",
              className,
            )}
            aria-label={selectedLocation?.description ?? "Select working directory"}
          >
            {selectedLocation?.kind === "repository" ? (
              <GitBranch className="h-3 w-3 shrink-0" />
            ) : (
              <FolderClosed className="h-3 w-3 shrink-0" />
            )}
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
                disabled={!value}
                className={cn(
                  "inline-flex items-center justify-center rounded-sm h-5 w-5 transition-colors",
                  !value
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
            {normalizedOptions.length > 0 ? (
              normalizedOptions.map((option) => {
                const location = resolveSessionLocation(option);
                if (!location) return null;
                const isSelected = option.cwd === value;

                return (
                  <DropdownMenuItem
                    key={option.cwd}
                    className="gap-2 py-1.5"
                    onSelect={() => onValueChange?.(isSelected ? undefined : option.cwd)}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", !isSelected && "opacity-0")} />
                    {location.kind === "repository" ? (
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <FolderClosed className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-xs">{location.label}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {option.cwd}
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
            disabled={!canChangeDirectory}
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
        initialPath={value}
      />
    </>
  );
}
