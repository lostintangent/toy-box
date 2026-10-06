import type { Channel, channelStatus } from "@channels/model";

/** Requests remain visible while a Channel is open; other attention is acknowledged by viewing it. */
export function channelSidebarStatus(
  channel: Channel,
  status: ReturnType<typeof channelStatus>,
  isOpen: boolean,
) {
  if (status === "waiting")
    return {
      kind: "waiting" as const,
      ariaLabel: `${channel.name} needs your attention`,
      tooltip: "Waiting for your response",
    };
  if (isOpen) return;
  if (status === "finished")
    return {
      kind: "finished" as const,
      ariaLabel: `${channel.name} completed its tasks`,
      tooltip: "All tasks completed",
    };
  if (status === "unread")
    return {
      kind: "unread" as const,
      ariaLabel: `${channel.name} has unread messages`,
      tooltip: "Channel has unread messages",
    };
}
