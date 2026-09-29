import type { ReactNode } from "react";
import type { ChannelAgent } from "@channels/model";
import { channelAgentPresence, type ChannelAgentPresence } from "@channels/model/presence";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { useWorkspaceSessionRunning } from "@workspace/hooks/state";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { WaitingIndicator } from "@/shared/ui/waiting-indicator";
import { cn } from "@/shared/utils";
import { AgentAvatar } from "./AgentAvatar";

/** One agent in a Channel. Its avatar shows whether it's working or waiting, and the line beneath
 *  its name says on what, or what it's for while idle. */
export function AgentItem({ agent, action }: { agent: ChannelAgent; action?: ReactNode }) {
  const preview = useSessionPreview();
  const presence = channelAgentPresence(agent, useWorkspaceSessionRunning(agent.id));
  const detail = presenceDetail(presence, agent.role);

  return (
    <div role="listitem" className="flex min-w-0 items-center gap-2.5 py-1 text-left">
      <SessionPreview sessionId={agent.id} side="left" sideOffset={10} {...preview}>
        <button
          type="button"
          aria-label={`Preview ${agent.name}'s session`}
          title={`Preview ${agent.name}'s session`}
          onMouseEnter={preview.onMouseEnter}
          onMouseLeave={preview.onMouseLeave}
          className="relative shrink-0 rounded-full"
        >
          <AgentAvatar name={agent.name} avatar={agent.avatar} className="size-6" />
          <PresenceMark presence={presence} />
        </button>
      </SessionPreview>
      <span className="flex min-w-0 flex-1 flex-col">
        <ScrollableFade className="whitespace-nowrap text-xs">
          <span className="shrink-0">{agent.name}</span>
        </ScrollableFade>
        {detail && (
          <ScrollableFade
            className={cn(
              "whitespace-nowrap text-2xs",
              presence.state === "waiting"
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            <span className="shrink-0">{detail}</span>
          </ScrollableFade>
        )}
      </span>
      {action}
    </div>
  );
}

/** The running arc around a working agent's avatar, or a waiting badge cut into its corner. */
function PresenceMark({ presence }: { presence: ChannelAgentPresence }) {
  switch (presence.state) {
    case "working":
      return (
        <RunningIndicator
          strokeWidth={1.25}
          className="pointer-events-none absolute -top-1.75 -left-1.75 size-9.5 text-muted-foreground"
        />
      );
    case "waiting":
      return (
        <WaitingIndicator className="pointer-events-none absolute -right-1 -bottom-1 size-3.5 rounded-full bg-panel ring-1 ring-panel" />
      );
    case "idle":
      return null;
  }
}

function presenceDetail(presence: ChannelAgentPresence, role?: string): string | undefined {
  switch (presence.state) {
    case "working":
      return presence.text ?? "Working";
    case "waiting":
      return `Waiting for ${presence.text}`;
    case "idle":
      return role;
  }
}
