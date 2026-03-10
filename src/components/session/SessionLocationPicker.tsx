import { SessionDirectoryPicker } from "./SessionDirectoryPicker";
import { WorktreeBranchMenu, type WorktreeProps } from "./WorktreeBranchMenu";
import type { SessionDirectoryOption } from "./sessionDirectoryOptions";

export type SessionLocationPickerProps = {
  // Directory state (always needed for the picker)
  value?: string;
  repository?: string;
  gitRoot?: string;
  options: SessionDirectoryOption[];
  className?: string;

  // Draft mode — enables directory selection + worktree toggle
  onValueChange?: (cwd: string | undefined) => void;
  disabled?: boolean;
  useWorktree?: boolean;
  onUseWorktreeChange?: (value: boolean) => void;

  // Active session — branch display + optional worktree actions
  branch?: string;
  worktreeProps?: WorktreeProps;
};

/**
 * Renders the appropriate location indicator for a session:
 * - Draft sessions: editable directory picker with worktree toggle
 * - Active worktree sessions: branch menu with merge/apply actions
 * - Active non-worktree sessions with branch: branch menu with actions disabled
 * - Active sessions without branch or worktree: read-only directory display
 */
export function SessionLocationPicker({
  value,
  repository,
  gitRoot,
  options,
  className,
  onValueChange,
  disabled,
  useWorktree,
  onUseWorktreeChange,
  branch,
  worktreeProps,
}: SessionLocationPickerProps) {
  // Active sessions with a branch (or worktree) show the branch menu.
  // Worktree sessions get merge/apply actions; non-worktree sessions show actions disabled.
  const isDraft = Boolean(onValueChange);
  if (!isDraft && (branch || worktreeProps)) {
    return (
      <WorktreeBranchMenu
        branch={branch}
        repository={repository}
        gitRoot={gitRoot}
        cwd={value}
        className={className}
        {...worktreeProps}
      />
    );
  }

  return (
    <SessionDirectoryPicker
      value={value}
      repository={repository}
      gitRoot={gitRoot}
      options={options}
      className={className}
      onValueChange={onValueChange}
      disabled={disabled}
      useWorktree={useWorktree}
      onUseWorktreeChange={onUseWorktreeChange}
    />
  );
}
