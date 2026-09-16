import { useState } from "react";
import type { Agent, AgentMembership, AgentMembershipStatus } from "@agents/model";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { selectWorkspaceSessionActivity, useWorkspaceSelector } from "@workspace/hooks/state";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import { AgentAvatar } from "./AgentAvatar";

type StatusMembership = AgentMembership & { status?: AgentMembershipStatus };

type WorkingAgent = {
  membership: StatusMembership;
  agent: Agent;
  status?: string;
};

/** Present currently working Agent memberships. */
export function AgentStatus({
  memberships,
  agents,
  variant = "normal",
}: {
  memberships: readonly StatusMembership[];
  agents: readonly Agent[];
  variant?: "normal" | "compact";
}) {
  const running = useWorkspaceSelector((workspace) =>
    memberships.map(
      ({ sessionId }) => selectWorkspaceSessionActivity(workspace, sessionId).running,
    ),
  );
  const working: WorkingAgent[] = memberships
    .flatMap((membership, index) => {
      if (!running[index]) return [];
      const agent = agents.find(({ id }) => id === membership.agentId);
      if (!agent) return [];
      const status = membership.status?.state === "working" ? membership.status.text : undefined;
      return [{ membership, agent, ...(status ? { status } : {}) }];
    })
    .sort((left, right) => left.agent.name.localeCompare(right.agent.name));

  if (working.length === 0) return null;

  if (variant === "compact") {
    return (
      <span
        role="status"
        aria-label={`${working.map(({ agent }) => agent.name).join(", ")} ${working.length === 1 ? "is" : "are"} working`}
      >
        <WorkingAgentAvatars entries={working} />
      </span>
    );
  }

  return <WorkingAgentStatus entries={working} />;
}

function WorkingAgentStatus({ entries }: { entries: readonly WorkingAgent[] }) {
  const [hoveredSessionId, setHoveredSessionId] = useState<string>();
  const selected =
    entries.find(({ membership }) => membership.sessionId === hoveredSessionId) ??
    (entries.length === 1 ? entries[0] : undefined);
  const label =
    selected?.status ??
    (selected ? `${selected.agent.name} is working` : "Multiple agents are working");

  return (
    <div
      role="status"
      className="flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
    >
      <WorkingAgentAvatars entries={entries} onHover={setHoveredSessionId} />
      <ScrollableFade className="w-fit whitespace-nowrap">
        <span className="shrink-0">{label}</span>
      </ScrollableFade>
      <WorkingDots />
    </div>
  );
}

function WorkingAgentAvatars({
  entries,
  onHover,
}: {
  entries: readonly WorkingAgent[];
  onHover?: (sessionId?: string) => void;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0",
        entries.length > 1 && "-space-x-2 hover:space-x-1 focus-within:space-x-1",
      )}
    >
      {entries.map((entry) => (
        <WorkingAgentAvatar key={entry.membership.sessionId} entry={entry} onHover={onHover} />
      ))}
    </span>
  );
}

function WorkingAgentAvatar({
  entry,
  onHover,
}: {
  entry: WorkingAgent;
  onHover?: (sessionId?: string) => void;
}) {
  const preview = useSessionPreview();
  const { membership, agent, status } = entry;

  return (
    <Tooltip>
      <SessionPreview sessionId={membership.sessionId} nativeButton={false} {...preview}>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              aria-label={agent.name}
              className="relative rounded-full transition-[margin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onMouseEnter={(event) => {
                preview.onMouseEnter(event);
                onHover?.(membership.sessionId);
              }}
              onMouseLeave={() => {
                preview.onMouseLeave();
                onHover?.();
              }}
            />
          }
        >
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            className="pointer-events-none size-6 ring-2 ring-[var(--surface-background,var(--color-panel))]"
          />
        </TooltipTrigger>
      </SessionPreview>
      <TooltipContent sideOffset={4}>
        {agent.name}
        {status ? ` · ${status}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function WorkingDots() {
  return (
    <span className="flex shrink-0 gap-0.5" aria-hidden>
      <span className="size-1 animate-pulse rounded-full bg-current" />
      <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
      <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}
