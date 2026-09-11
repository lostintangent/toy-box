import type { QueryClient } from "@tanstack/react-query";
import type { ChannelList } from "@channels/model";
import { channelQueries } from "@channels/queries";
import type { WorkspaceEvent } from "@workspace/model/events";

export function applyChannelListEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  switch (event.type) {
    case "channel.upserted":
      queryClient.setQueryData<ChannelList>(channelQueries.listKey(), (list) => {
        if (!list) return { channels: [event.channel], memberships: [] };
        const next = list.channels.filter(({ id }) => id !== event.channel.id);
        next.push(event.channel);
        return {
          ...list,
          channels: next.sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
          ),
        };
      });
      return;
    case "channel.deleted":
      queryClient.removeQueries({
        queryKey: channelQueries.detail(event.channelId).queryKey,
        exact: true,
      });
      queryClient.setQueryData<ChannelList>(channelQueries.listKey(), (list) =>
        list
          ? {
              channels: list.channels.filter(({ id }) => id !== event.channelId),
              memberships: list.memberships.filter(
                ({ host }) => host.kind !== "channel" || host.channelId !== event.channelId,
              ),
            }
          : list,
      );
      return;
    case "agent.membership.changed":
      if (event.host.kind === "channel") void invalidateChannelListQuery(queryClient);
      return;
    default:
      return;
  }
}

export function invalidateChannelListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: channelQueries.listKey(), exact: true });
}
