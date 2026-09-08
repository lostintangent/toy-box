import type { ReactNode } from "react";
import { GitFork } from "lucide-react";
import type { Agent, AgentMembership } from "@agents/model";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { AgentAvatar } from "./AgentAvatar";

/** One Agent membership in a host roster. */
export function AgentMembershipItem({
  membership,
  agent,
  action,
}: {
  membership: AgentMembership;
  agent: Agent;
  action?: ReactNode;
}) {
  const preview = useSessionPreview();

  return (
    <SessionPreview
      sessionId={membership.sessionId}
      side="left"
      sideOffset={10}
      nativeButton={false}
      {...preview}
    >
      <div
        role="listitem"
        onMouseEnter={preview.onMouseEnter}
        onMouseLeave={preview.onMouseLeave}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
      >
        <AgentAvatar name={agent.name} avatar={agent.avatar} className="size-5" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <ScrollableFade className="whitespace-nowrap text-xs">
            <span className="shrink-0">{agent.name}</span>
          </ScrollableFade>
          {membership.executionMode === "worktree" && (
            <GitFork className="size-3 text-cyan-600" aria-label="Uses a worktree" />
          )}
        </span>
        {action && (
          <span
            onMouseEnter={(event) => {
              event.stopPropagation();
              preview.close();
            }}
          >
            {action}
          </span>
        )}
      </div>
    </SessionPreview>
  );
}
