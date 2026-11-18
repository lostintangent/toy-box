import type { ReactNode } from "react";
import { Bell, SquareTerminal } from "lucide-react";
import type { ChannelAgent } from "@channels/model";
import type { ChannelAgentPresence } from "@channels/model/presence";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { useChannelPane } from "../pane/ChannelPaneContext";
import { clockFormatter } from "@/shared/ui/clock-time";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { cn } from "@/shared/utils";
import { AgentAvatar } from "./AgentAvatar";

/** One agent in a Channel. The ring around its avatar shows whether it's working or waiting, the
 *  line beneath its name says on what, or what it's for while idle. A waiting agent shows the
 *  terminal of the wake command it waits on, or else a bell counting down to when it checks back. */
export function AgentItem({
  agent,
  now,
  action,
}: {
  agent: ChannelAgent;
  now: number;
  action?: ReactNode;
}) {
  const preview = useSessionPreview();
  const presence = useChannelPane().presence[agent.id] ?? { state: "idle" };
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
          <AgentAvatar agent={agent} className="size-6" />
          {presence.state !== "idle" && (
            <RunningIndicator
              waiting={presence.state === "waiting"}
              strokeWidth={1.25}
              className="pointer-events-none absolute -top-1.75 -left-1.75 size-9.5 text-muted-foreground"
            />
          )}
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
      {presence.state === "waiting" &&
        (presence.wakeCommand ? (
          <WakeCommand command={presence.wakeCommand} wakeAt={presence.wakeAt} />
        ) : (
          presence.wakeAt && <WakeCountdown wakeAt={presence.wakeAt} now={now} />
        ))}
      {action}
    </div>
  );
}

function presenceDetail(presence: ChannelAgentPresence, role?: string) {
  switch (presence.state) {
    case "working":
      return presence.text ?? "Working";
    case "waiting":
      return `Waiting for ${presence.text}`;
    case "idle":
      return role;
  }
}

function WakeCommand({ command, wakeAt }: { command: string; wakeAt?: string }) {
  const checksBack = wakeAt ? `, or checks back at ${clockFormatter.format(new Date(wakeAt))}` : "";
  const label = `Wakes when its command exits${checksBack}\n${command}`;
  return (
    <span role="img" title={label} aria-label={label} className="shrink-0 text-muted-foreground">
      <SquareTerminal aria-hidden className="size-3" />
    </span>
  );
}

function WakeCountdown({ wakeAt, now }: { wakeAt: string; now: number }) {
  const label = `Checks back at ${clockFormatter.format(new Date(wakeAt))}`;
  return (
    <time
      dateTime={wakeAt}
      title={label}
      aria-label={label}
      suppressHydrationWarning
      className="flex shrink-0 items-center gap-1 text-2xs tabular-nums text-muted-foreground"
    >
      <Bell aria-hidden className="size-3" />
      {formatWakeCountdown(Date.parse(wakeAt) - now)}
    </time>
  );
}

/** "39m", "1h", or "1h 21m" until a wake, rounded up to the minute, and "Due" once it passes. */
export function formatWakeCountdown(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes <= 0) return "Due";
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${minutes / 60}h`;
}
