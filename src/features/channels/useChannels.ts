import { useSuspenseQuery } from "@tanstack/react-query";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { channelLead, channelStatus } from "./model";
import { channelQueries } from "./queries";

/** The shared catalog plus live team activity, derived from session activity. */
export function useChannels() {
  const {
    data: { channels, members },
  } = useSuspenseQuery(channelQueries.list());

  return useSessionsActivity((activities) =>
    channels.map((channel) => ({
      channel,
      agents: [
        channelLead(channel.id),
        ...members.filter(({ channelId }) => channelId === channel.id),
      ].map((agent) => ({
        ...agent,
        isRunning: activities[agent.id]?.status === "running",
      })),
      status: channelStatus(channel),
    })),
  );
}
