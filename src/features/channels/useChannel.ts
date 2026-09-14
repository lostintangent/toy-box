import { useEffect } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { Channel, ChannelEvent, ChannelState } from "./model";
import { mergeChannelMessages, reduceChannelState } from "./model/reducer";
import { channelMutations } from "./mutations";
import { channelQueries } from "./queries";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";

/** Own one open Channel's state, incremental connection, and read lifecycle. */
export function useChannel(channel: Channel, paneIsVisible: boolean) {
  const { id: channelId, latestSequence, seenThrough } = channel;
  const queryClient = useQueryClient();
  const pageIsVisible = usePageVisibility();
  const isVisible = paneIsVisible && pageIsVisible;
  const { data: state } = useSuspenseQuery(channelQueries.detail(channelId));
  const { mutate: markRead } = useMutation(channelMutations.markRead());

  useEffect(() => {
    if (!isVisible || seenThrough >= latestSequence) return;
    markRead({ channelId, sequence: latestSequence });
  }, [channelId, isVisible, latestSequence, markRead, seenThrough]);

  useEffect(() => {
    if (!isVisible) return;
    const queryKey = channelQueries.detail(channelId).queryKey;
    const revision = queryClient.getQueryData<ChannelState>(queryKey)?.revision ?? 0;
    const source = new EventSource(
      `/api/channels/${encodeURIComponent(channelId)}?after=${revision}`,
    );
    source.onmessage = ({ data }) => {
      if (!data) return;
      try {
        const event = JSON.parse(data) as ChannelEvent;
        queryClient.setQueryData<ChannelState>(queryKey, (state) =>
          state ? reduceChannelState(state, event) : state,
        );
      } catch (error) {
        console.error("Failed to parse Channel event:", error);
      }
    };
    return () => source.close();
  }, [channelId, isVisible, queryClient]);

  const loadPrevious = async () => {
    const beforeSequence = state.messages[0]?.sequence;
    if (beforeSequence === undefined || beforeSequence <= 1) return;
    const messages = await queryClient
      .query(channelQueries.messagesBefore(channelId, beforeSequence))
      .catch((error: unknown) => {
        console.error("Failed to load previous Channel messages:", error);
        return [];
      });
    if (messages.length === 0) return;
    queryClient.setQueryData<ChannelState>(channelQueries.detail(channelId).queryKey, (state) =>
      state
        ? {
            ...state,
            messages: mergeChannelMessages(state.messages, messages),
          }
        : state,
    );
  };

  return { state, loadPrevious };
}
