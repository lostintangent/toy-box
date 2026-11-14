import type { Channel, channelAttention } from "@channels/model";

/** How the sidebar labels what a Channel asks of you, or that its team is working. A waiting
 *  Channel's request preview explains it, so it has no tooltip. */
export function channelSidebarStatus(
  { name }: Omit<Channel, "tasks">,
  kind: NonNullable<ReturnType<typeof channelAttention>> | "running",
) {
  const [ariaLabel, tooltip] = (
    {
      waiting: [`${name} needs your attention`, undefined],
      finished: [`${name} completed its tasks`, "All tasks completed"],
      unread: [`${name} has unread messages`, "Channel has unread messages"],
      running: [`${name} is working`, "Team is working"],
    } as const
  )[kind];
  return { kind, ariaLabel, tooltip };
}
