import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelEvent, ChannelSnapshot } from "./model";
import { reduceChannelSnapshot } from "./model/reducer";
import { channelMutations } from "./mutations";
import { channelQueries } from "./queries";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";

/** Own one open Channel's snapshot, incremental connection, and read lifecycle. */
export function useChannel(channelId: string, isVisible: boolean) {
  const queryClient = useQueryClient();
  const pageIsVisible = usePageVisibility();
  const detail = useQuery(channelQueries.detail(channelId));
  const channels = useQuery(channelQueries.list());
  const channel = channels.data?.find(({ id }) => id === channelId);
  const hasSnapshot = detail.data !== undefined;
  const { mutate: markRead } = useMutation(channelMutations.markRead());
  const latestSequence = channel?.latestSequence ?? 0;
  const seenThrough = channel?.seenThrough ?? 0;

  useEffect(() => {
    if (!isVisible || seenThrough >= latestSequence) return;
    markRead({ channelId, sequence: latestSequence });
  }, [channelId, isVisible, latestSequence, markRead, seenThrough]);

  useEffect(() => {
    if (!isVisible || !pageIsVisible || !hasSnapshot) return;
    const queryKey = channelQueries.detail(channelId).queryKey;
    const cursor = queryClient.getQueryData<ChannelSnapshot>(queryKey)?.cursor ?? 0;
    const source = new EventSource(
      `/api/channels/${encodeURIComponent(channelId)}?after=${cursor}`,
    );
    source.onmessage = ({ data }) => {
      if (!data) return;
      try {
        const event = JSON.parse(data) as ChannelEvent;
        queryClient.setQueryData<ChannelSnapshot>(queryKey, (snapshot) =>
          snapshot ? reduceChannelSnapshot(snapshot, event) : snapshot,
        );
      } catch (error) {
        console.error("Failed to parse Channel event:", error);
      }
    };
    return () => source.close();
  }, [channelId, hasSnapshot, isVisible, pageIsVisible, queryClient]);

  return { channel, snapshot: detail.data, error: detail.error ?? channels.error };
}
