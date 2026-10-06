import type { QueryClient } from "@tanstack/react-query";
import type { ChannelList } from "@channels/model";
import { channelQueries, type ChannelQueryData } from "@channels/queries";
import type { WorkspaceEvent } from "@workspace/model/events";
import { mergeChannelMessages } from "./model/reducer";

/** Page backward through a target message, retrying only pages overtaken by the stream. */
export async function loadChannelHistory(
  queryClient: QueryClient,
  channelId: string,
  throughSequence?: number,
): Promise<void> {
  const key = channelQueries.detail(channelId).queryKey;
  for (;;) {
    const state = queryClient.getQueryData(key);
    const before = state?.messages[0]?.sequence;
    if (
      before === undefined ||
      before <= 1 ||
      (throughSequence !== undefined && before <= throughSequence)
    )
      return;
    const page = await queryClient.query(channelQueries.messagesBefore(channelId, before));
    const current = queryClient.getQueryData(key);
    if (!current) return;
    // A page ahead of the stream is safe: replay will still reach its revision.
    if (current.revision > page.revision) continue;
    if (page.messages.length)
      queryClient.setQueryData<ChannelQueryData>(key, {
        ...current,
        messages: mergeChannelMessages(current.messages, page.messages),
      });
    if (
      !page.messages.length ||
      throughSequence === undefined ||
      page.messages[0]!.sequence <= throughSequence
    )
      return;
  }
}

/** A detail stream leaves its terminal value in place; Workspace also retires its query. */
export function removeChannelFromList(queryClient: QueryClient, channelId: string): void {
  queryClient.setQueryData<ChannelList>(channelQueries.listKey(), (list) =>
    list
      ? {
          channels: list.channels.filter(({ id }) => id !== channelId),
          members: list.members.filter((member) => member.channelId !== channelId),
        }
      : list,
  );
  replaceOverlappingListRead(queryClient);
}

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
      removeChannelFromList(queryClient, event.channelId);
      return;
    case "channel.member.upserted":
      queryClient.setQueryData<ChannelList>(
        channelQueries.listKey(),
        (list) =>
          list && {
            ...list,
            members: list.members.some(({ id }) => id === event.member.id)
              ? list.members.map((member) =>
                  member.id === event.member.id ? event.member : member,
                )
              : [event.member, ...list.members],
          },
      );
      break;
    case "channel.member.deleted":
      queryClient.setQueryData<ChannelList>(
        channelQueries.listKey(),
        (list) =>
          list && {
            ...list,
            members: list.members.filter(({ id }) => id !== event.agentId),
          },
      );
      break;
    default:
      return;
  }
  replaceOverlappingListRead(queryClient);
}

/** Read after the commit when an older catalog response could overwrite the event. */
function replaceOverlappingListRead(queryClient: QueryClient): void {
  if (queryClient.getQueryState(channelQueries.listKey())?.fetchStatus === "fetching") {
    void queryClient.refetchQueries({ queryKey: channelQueries.listKey(), exact: true });
  }
}

export function invalidateChannelListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: channelQueries.listKey(), exact: true });
}
