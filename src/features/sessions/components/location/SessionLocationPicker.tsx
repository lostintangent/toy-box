import { SessionDirectoryPicker } from "./directory/SessionDirectoryPicker";
import { SessionBranchMenu, type WorktreeBranchActions } from "./git/SessionBranchMenu";
import { useSessionContext } from "./useSessionContext";

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

export function SessionLocationPicker(props: SessionLocationPickerProps) {
  if (props.isLoading || props.onValueChange) {
    return <SessionDirectoryPicker {...props} />;
  }
  return <ReadonlySessionLocationPicker {...props} />;
}

function ReadonlySessionLocationPicker({
  value,
  repository,
  gitRoot,
  className,
  branch,
  worktreeActions,
}: SessionLocationPickerProps) {
  const { context, error } = useSessionContext({
    directory: value ?? undefined,
    repository,
    gitRoot,
    branch,
  });

  return (
    <span
      className="inline-flex min-w-0"
      aria-description={error?.message}
      title={error ? `Repository information unavailable: ${error.message}` : undefined}
    >
      {context.branch || worktreeActions ? (
        <SessionBranchMenu
          branch={context.branch}
          repository={context.repository}
          gitRoot={context.gitRoot}
          cwd={context.directory}
          className={className}
          {...worktreeActions}
        />
      ) : (
        <SessionDirectoryPicker
          value={context.directory}
          repository={context.repository}
          gitRoot={context.gitRoot}
          className={className}
        />
      )}
    </span>
  );
}
