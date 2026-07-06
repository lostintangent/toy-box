import { FolderClosed, GitBranch, GitFork } from "lucide-react";
import type { SessionLocationDisplay } from "./locationDisplay";

type SessionLocationIconProps = {
  kind?: SessionLocationDisplay["kind"];
  isWorktree?: boolean;
  className?: string;
};

export function SessionLocationIcon({ kind, isWorktree, className }: SessionLocationIconProps) {
  if (isWorktree) return <GitFork className={className} />;
  if (kind === "repository") return <GitBranch className={className} />;
  return <FolderClosed className={className} />;
}
