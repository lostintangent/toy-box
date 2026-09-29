import type { QueryClient } from "@tanstack/react-query";
import type { ChannelList } from "@channels/model";
import { channelQueries } from "@channels/queries";
import type { WorkspaceEvent } from "@workspace/model/events";

export function applyChannelListEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  switch (event.type) {
    case "channel.upserted":
      queryClient.setQueryData<ChannelList>(channelQueries.listKey(), (list) => {
        if (!list) return list;
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
      break;
    case "channel.deleted":
      queryClient.removeQueries({
        queryKey: channelQueries.detail(event.channelId).queryKey,
        exact: true,
      });
      queryClient.setQueryData<ChannelList>(channelQueries.listKey(), (list) =>
        list
          ? {
              channels: list.channels.filter(({ id }) => id !== event.channelId),
              members: list.members.filter(({ channelId }) => channelId !== event.channelId),
            }
          : list,
      );
      break;
    case "channel.members.changed":
      void invalidateChannelListQuery(queryClient);
      return;
    default:
      return;
  }
  // Replace an overlapping snapshot read with one started after this committed change.
  if (queryClient.getQueryState(channelQueries.listKey())?.fetchStatus === "fetching") {
    void queryClient.refetchQueries({ queryKey: channelQueries.listKey(), exact: true });
  }
}

export function invalidateChannelListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: channelQueries.listKey(), exact: true });
}
