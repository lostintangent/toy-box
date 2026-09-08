import type { QueryClient } from "@tanstack/react-query";
import type { Channel } from "@channels/model";
import { channelQueries } from "@channels/queries";
import type { WorkspaceEvent } from "@workspace/model/events";

export function applyChannelListEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  switch (event.type) {
    case "channel.upserted":
      queryClient.setQueryData<Channel[]>(channelQueries.listKey(), (channels) => {
        if (!channels) return [event.channel];
        const next = channels.filter(({ id }) => id !== event.channel.id);
        next.push(event.channel);
        return next.sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
      });
      return;
    case "channel.deleted":
      queryClient.removeQueries({
        queryKey: channelQueries.detail(event.channelId).queryKey,
        exact: true,
      });
      queryClient.setQueryData<Channel[]>(channelQueries.listKey(), (channels) =>
        channels?.filter(({ id }) => id !== event.channelId),
      );
      return;
    default:
      return;
  }
}

export function invalidateChannelListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: channelQueries.listKey(), exact: true });
}
