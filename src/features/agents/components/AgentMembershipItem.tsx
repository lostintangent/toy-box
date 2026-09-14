import type { ReactNode } from "react";
import { GitFork } from "lucide-react";
import type { Agent, AgentMembership, AgentMembershipStatus } from "@agents/model";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { AgentAvatar } from "./AgentAvatar";

/** One Agent membership in a host. */
export function AgentMembershipItem({
  membership,
  agent,
  status,
  action,
}: {
  membership: AgentMembership;
  agent: Agent;
  status?: AgentMembershipStatus;
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
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <ScrollableFade className="whitespace-nowrap text-xs">
              <span className="shrink-0">{agent.name}</span>
            </ScrollableFade>
            {membership.executionMode === "worktree" && (
              <GitFork className="size-3 text-cyan-600" aria-label="Uses a worktree" />
            )}
          </span>
          {status && (
            <ScrollableFade className="whitespace-nowrap text-2xs text-muted-foreground">
              <span className="shrink-0">
                {status.state === "waiting" ? `Waiting for ${status.text}` : status.text}
              </span>
            </ScrollableFade>
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
