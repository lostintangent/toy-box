import type { ReactNode } from "react";
import type { ChannelMember } from "@channels/model";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { AgentAvatar } from "./AgentAvatar";

/** One agent in a Channel. */
export function AgentItem({ agent, action }: { agent: ChannelMember; action?: ReactNode }) {
  const preview = useSessionPreview();

  return (
    <SessionPreview
      sessionId={agent.id}
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
          <ScrollableFade className="whitespace-nowrap text-xs">
            <span className="shrink-0">{agent.name}</span>
          </ScrollableFade>
          {agent.status && (
            <ScrollableFade className="whitespace-nowrap text-2xs text-muted-foreground">
              <span className="shrink-0">
                {agent.status.state === "waiting"
                  ? `Waiting for ${agent.status.text}`
                  : agent.status.text}
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
