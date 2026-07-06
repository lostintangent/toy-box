import { SessionDirectoryPicker } from "./directory/SessionDirectoryPicker";
import { SessionBranchMenu, type WorktreeBranchActions } from "./git/SessionBranchMenu";
import type { SessionDirectoryOption } from "./directory/directoryOptions";

export type SessionLocationPickerProps = {
  value?: string;
  repository?: string;
  gitRoot?: string;
  className?: string;

  // Used when rendering the directory picker.
  options?: SessionDirectoryOption[];

  // Draft sessions can change their working directory and opt into a worktree.
  onValueChange?: (cwd: string | undefined) => void;
  disabled?: boolean;
  useWorktree?: boolean;
  onUseWorktreeChange?: (value: boolean) => void;

  // Active sessions may expose branch/worktree actions instead of directory picking.
  branch?: string;
  worktreeActions?: WorktreeBranchActions;
};

export function SessionLocationPicker({
  value,
  repository,
  gitRoot,
  options = [],
  className,
  onValueChange,
  disabled,
  useWorktree,
  onUseWorktreeChange,
  branch,
  worktreeActions,
}: SessionLocationPickerProps) {
  const isDraft = Boolean(onValueChange);
  if (!isDraft && (branch || worktreeActions)) {
    return (
      <SessionBranchMenu
        branch={branch}
        repository={repository}
        gitRoot={gitRoot}
        cwd={value}
        className={className}
        {...worktreeActions}
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
