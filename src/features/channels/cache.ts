import type { QueryClient } from "@tanstack/react-query";
import { channelQueries, type ChannelQueryData } from "@channels/queries";
import type { WorkspaceCache } from "@workspace/sync";
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

export default {
  preload: (queryClient) => queryClient.ensureQueryData(channelQueries.list),
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "channel.deleted":
        queryClient.removeQueries({
          queryKey: channelQueries.detail(event.channelId).queryKey,
          exact: true,
        });
        channelQueries.list.apply(queryClient, event);
        return;
      case "channel.upserted":
      case "channel.member.upserted":
      case "channel.member.deleted":
        channelQueries.list.apply(queryClient, event);
        return;
    }
  },
  refresh: channelQueries.list.refresh,
} satisfies WorkspaceCache;
