import { useState } from "react";
import type { ChannelAgent } from "@channels/model";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { selectWorkspaceSessionActivity, useWorkspaceSelector } from "@workspace/hooks/state";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import { AgentAvatar } from "./AgentAvatar";

type WorkingAgent = {
  agent: ChannelAgent;
  status?: string;
};

/** Present currently working Channel agents. */
export function AgentStatus({
  agents,
  variant = "normal",
}: {
  agents: readonly ChannelAgent[];
  variant?: "normal" | "compact";
}) {
  const running = useWorkspaceSelector((workspace) =>
    agents.map(({ id }) => selectWorkspaceSessionActivity(workspace, id).running),
  );
  const working: WorkingAgent[] = agents
    .flatMap((agent, index) => {
      if (!running[index]) return [];
      const status = agent.status?.state === "working" ? agent.status.text : undefined;
      return [{ agent, ...(status ? { status } : {}) }];
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
    entries.find(({ agent }) => agent.id === hoveredSessionId) ??
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
        <WorkingAgentAvatar key={entry.agent.id} entry={entry} onHover={onHover} />
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
  const { agent, status } = entry;

  return (
    <Tooltip>
      <SessionPreview sessionId={agent.id} nativeButton={false} {...preview}>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              aria-label={agent.name}
              className="relative rounded-full transition-[margin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onMouseEnter={(event) => {
                preview.onMouseEnter(event);
                onHover?.(agent.id);
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
