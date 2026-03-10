import { useCallback, useMemo, useState } from "react";
import { ChevronDown, FolderClosed, FolderOpen, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  onValueChange?: (cwd: string) => void;
  disabled?: boolean;
  className?: string;
};

export function SessionDirectoryPicker({
  value,
  repository,
  gitRoot,
  options,
  onValueChange,
  disabled = false,
  className,
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
            disabled={!canChangeDirectory}
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
          <DropdownMenuLabel className="text-xs">Working Directory</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {normalizedOptions.length > 0 ? (
            <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
              {normalizedOptions.map((option) => {
                const location = resolveSessionLocation(option);
                if (!location) return null;

                return (
                  <DropdownMenuRadioItem
                    key={option.cwd}
                    value={option.cwd}
                    className="gap-2 py-1.5"
                  >
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
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          ) : (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No recent directories
            </DropdownMenuItem>
          )}
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
