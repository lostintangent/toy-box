import { useSuspenseQuery } from "@tanstack/react-query";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { channelLead, channelStatus } from "./model";
import { channelQueries } from "./queries";

/** The shared catalog plus live team activity, derived from the existing workspace cache. */
export function useChannels() {
  const {
    data: { channels, members },
  } = useSuspenseQuery(channelQueries.list());

  return useWorkspaceSelector((workspace) =>
    channels.map((channel) => ({
      channel,
      agents: [
        channelLead(channel.id),
        ...members.filter(({ channelId }) => channelId === channel.id),
      ].map((agent) => ({
        ...agent,
        isRunning: workspace.sessionStates[agent.id]?.status === "running",
      })),
      status: channelStatus(channel),
    })),
  );
}
