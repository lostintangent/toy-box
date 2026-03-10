import { FileOutput, FolderClosed, GitBranch, GitFork, GitMerge, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { resolveSessionLocation } from "./sessionLocation";
import { cn } from "@/lib/utils";

export type WorktreeProps = {
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  onMerge?: () => void;
  onApply?: () => void;
  isWorktreeBusy?: boolean;
};

type WorktreeBranchMenuProps = WorktreeProps & {
  /** Current git branch (for non-worktree sessions) */
  branch?: string;
  /** Location info for the trigger label */
  repository?: string;
  gitRoot?: string;
  cwd?: string;
  className?: string;
};

export function WorktreeBranchMenu({
  branch,
  repository,
  gitRoot,
  cwd,
  worktreeBranch,
  worktreeBaseBranch,
  onMerge,
  onApply,
  isWorktreeBusy,
  className,
}: WorktreeBranchMenuProps) {
  const isWorktreeMode = Boolean(worktreeBranch);
  const location = resolveSessionLocation({ repository, gitRoot, cwd });

  return (
    <DropdownMenu>
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
          aria-label={location?.description ?? "Branch menu"}
        >
          {isWorktreeMode ? (
            <GitFork className="h-3 w-3 shrink-0" />
          ) : location?.kind === "repository" ? (
            <GitBranch className="h-3 w-3 shrink-0" />
          ) : (
            <FolderClosed className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{location?.label ?? "unknown"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">
          {isWorktreeMode ? "Worktree Branch" : "Branch"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs gap-2 py-1.5">
          {isWorktreeMode ? (
            <GitFork className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{worktreeBranch ?? branch ?? "unknown"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-xs gap-2"
          disabled={!isWorktreeMode || isWorktreeBusy}
          onSelect={() => onMerge?.()}
        >
          {isWorktreeBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          ) : (
            <GitMerge className="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
          )}
          {`Merge into ${worktreeBaseBranch ?? "base"}`}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-xs gap-2"
          disabled={!isWorktreeMode || isWorktreeBusy}
          onSelect={() => onApply?.()}
        >
          {isWorktreeBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          ) : (
            <FileOutput className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
          )}
          {`Apply to ${worktreeBaseBranch ?? "base"}`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
