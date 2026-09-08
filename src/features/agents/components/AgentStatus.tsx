import { CircleHelp, GitFork } from "lucide-react";
import type { Agent, AgentMembership } from "@agents/model";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { selectWorkspaceSessionActivity, useWorkspaceSelector } from "@workspace/hooks/state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import { AgentAvatar } from "./AgentAvatar";

type AgentStatusEntry = {
  membership: AgentMembership;
  agent: Agent;
  status: "working" | "waiting" | undefined;
};

/** Present the Session-backed status of Agent memberships. */
export function AgentStatus({
  memberships,
  agents,
}: {
  memberships: readonly AgentMembership[];
  agents: readonly Agent[];
}) {
  const statuses = useWorkspaceSelector((workspace) =>
    memberships.map<AgentStatusEntry["status"]>(({ sessionId }) => {
      const { running, waiting } = selectWorkspaceSessionActivity(workspace, sessionId);
      return running ? "working" : waiting ? "waiting" : undefined;
    }),
  );
  const entries: AgentStatusEntry[] = memberships
    .map((membership, index) => ({
      membership,
      agent: agents.find(({ id }) => id === membership.agentId)!,
      status: statuses[index],
    }))
    .sort((left, right) => left.agent.name.localeCompare(right.agent.name));
  const working = entries.filter(({ status }) => status === "working");
  const waiting = entries.filter(({ status }) => status === "waiting");

  return (
    <>
      {working.length > 1 ? (
        <WorkingAgentGroup entries={working} />
      ) : (
        working.map(({ membership, agent }) => (
          <AgentStatusItem key={membership.sessionId} membership={membership} agent={agent} />
        ))
      )}
      {waiting.map(({ membership, agent }) => (
        <AgentStatusItem key={membership.sessionId} membership={membership} agent={agent} waiting />
      ))}
    </>
  );
}

function AgentStatusItem({
  membership,
  agent,
  waiting = false,
}: {
  membership: AgentMembership;
  agent: Agent;
  waiting?: boolean;
}) {
  const preview = useSessionPreview();

  return (
    <SessionPreview sessionId={membership.sessionId} nativeButton={false} {...preview}>
      <div
        onMouseEnter={preview.onMouseEnter}
        onMouseLeave={preview.onMouseLeave}
        className={cn(
          "flex items-center gap-2 rounded-full px-2 py-1 text-xs transition-colors hover:bg-muted",
          waiting ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
        )}
      >
        <AgentAvatar name={agent.name} avatar={agent.avatar} className="size-6" />
        <span>
          {agent.name} {waiting ? "needs input" : "is working"}
        </span>
        {waiting ? <CircleHelp className="size-3" aria-hidden /> : <WorkingDots />}
        {membership.executionMode === "worktree" && (
          <GitFork className="size-3 text-cyan-600" aria-label="Uses a worktree" />
        )}
      </div>
    </SessionPreview>
  );
}

function WorkingAgentGroup({ entries }: { entries: readonly AgentStatusEntry[] }) {
  return (
    <div className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted">
      <div className="flex -space-x-2 hover:space-x-1 focus-within:space-x-1">
        {entries.map(({ membership, agent }) => (
          <WorkingAgentAvatar key={membership.sessionId} membership={membership} agent={agent} />
        ))}
      </div>
      <span>Multiple agents are working</span>
      <WorkingDots />
    </div>
  );
}

function WorkingAgentAvatar({ membership, agent }: { membership: AgentMembership; agent: Agent }) {
  const preview = useSessionPreview();

  return (
    <Tooltip>
      <SessionPreview sessionId={membership.sessionId} nativeButton={false} {...preview}>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              aria-label={agent.name}
              className="relative rounded-full transition-[margin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onMouseEnter={preview.onMouseEnter}
              onMouseLeave={preview.onMouseLeave}
            />
          }
        >
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            className="pointer-events-none size-6 ring-2 ring-panel"
          />
        </TooltipTrigger>
      </SessionPreview>
      <TooltipContent sideOffset={4}>{agent.name}</TooltipContent>
    </Tooltip>
  );
}

function WorkingDots() {
  return (
    <span className="flex gap-0.5" aria-hidden>
      <span className="size-1 animate-pulse rounded-full bg-current" />
      <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
      <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}
