import { channelHasUnread, type Channel } from "@channels/model";

/** Requests remain visible while a Channel is open; other attention is acknowledged by viewing it. */
export function channelAttention(channel: Channel, isOpen: boolean) {
  if (channel.hasPendingRequest)
    return {
      kind: "waiting" as const,
      ariaLabel: `${channel.name} needs your attention`,
      tooltip: "Waiting for your response",
    };
  if (isOpen) return;
  if (channel.hasUnreadCompletion)
    return {
      kind: "finished" as const,
      ariaLabel: `${channel.name} is done`,
      tooltip: "Channel marked as done",
    };
  if (channelHasUnread(channel))
    return {
      kind: "unread" as const,
      ariaLabel: `${channel.name} has unread messages`,
      tooltip: "Channel has unread messages",
    };
}
