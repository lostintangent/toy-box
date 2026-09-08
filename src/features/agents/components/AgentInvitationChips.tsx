import { GitFork } from "lucide-react";
import type { Agent, AgentExecutionMode } from "@agents/model";
import { cn } from "@/shared/utils";
import { AgentAvatar } from "./AgentAvatar";

export function AgentInvitationChips({
  invitations,
  canUseWorktrees,
  onExecutionModeChange,
}: {
  invitations: readonly { agent: Agent; executionMode: AgentExecutionMode }[];
  canUseWorktrees: boolean;
  onExecutionModeChange: (agentId: string, mode: AgentExecutionMode) => void;
}) {
  if (invitations.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2 pb-1">
      {invitations.map(({ agent, executionMode }) => {
        const usesWorktree = executionMode === "worktree";
        const showsWorkspace = canUseWorktrees || usesWorktree;
        return (
          <div
            key={agent.id}
            className="flex min-w-0 items-center gap-2 rounded-full border bg-muted/30 py-1 pl-1.5 pr-2 text-2xs"
          >
            <AgentAvatar name={agent.name} avatar={agent.avatar} className="size-5" />
            <span className="truncate">Invite {agent.name}</span>
            {showsWorkspace && (
              <button
                type="button"
                aria-pressed={usesWorktree}
                aria-label={`${
                  usesWorktree ? "Use the shared workspace" : "Use an isolated worktree"
                } for ${agent.name}`}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors",
                  usesWorktree
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() =>
                  onExecutionModeChange(agent.id, usesWorktree ? "shared" : "worktree")
                }
              >
                <GitFork className="size-3" /> {usesWorktree ? "Worktree" : "Shared"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
