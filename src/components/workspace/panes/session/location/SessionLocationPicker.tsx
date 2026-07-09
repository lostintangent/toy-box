import { SessionDirectoryPicker } from "./directory/SessionDirectoryPicker";
import { SessionBranchMenu, type WorktreeBranchActions } from "./git/SessionBranchMenu";

export type SessionLocationPickerProps = {
  value?: string | null;
  repository?: string;
  gitRoot?: string;
  className?: string;
  isLoading?: boolean;

  // Draft sessions can change their working directory and opt into a worktree.
  onValueChange?: (cwd: string | null) => void;
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
  className,
  isLoading,
  onValueChange,
  useWorktree,
  onUseWorktreeChange,
  branch,
  worktreeActions,
}: SessionLocationPickerProps) {
  if (isLoading) {
    return <SessionDirectoryPicker className={className} isLoading />;
  }

  if (!onValueChange && (branch || worktreeActions)) {
    return (
      <SessionBranchMenu
        branch={branch}
        repository={repository}
        gitRoot={gitRoot}
        cwd={value ?? undefined}
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
      className={className}
      onValueChange={onValueChange}
      useWorktree={useWorktree}
      onUseWorktreeChange={onUseWorktreeChange}
    />
  );
}
