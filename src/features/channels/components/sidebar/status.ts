import type { Channel, channelAttention } from "@channels/model";

/** How the sidebar labels what a Channel asks of you. */
export function channelSidebarStatus(
  { name }: Omit<Channel, "tasks">,
  kind: NonNullable<ReturnType<typeof channelAttention>>,
) {
  const [ariaLabel, tooltip] = {
    waiting: [`${name} needs your attention`, "Waiting for your response"],
    finished: [`${name} completed its tasks`, "All tasks completed"],
    unread: [`${name} has unread messages`, "Channel has unread messages"],
  }[kind];
  return { kind, ariaLabel, tooltip };
}
