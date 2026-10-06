import { reduceChannelState } from "./model/reducer";
import { experimental_streamedQuery as streamedQuery, queryOptions } from "@tanstack/react-query";
import { type ChannelObservationEvent, type ChannelState, type ChannelMessage } from "./model";
import { listChannels } from "@channels/server/functions";
import { ChannelStreamError, streamChannel } from "./stream";
import { removeChannelFromList } from "./queryCache";

/** Browser arrival is distinct from cached content and from later live updates. */
export type ChannelQueryData = ChannelState & {
  arrival: { id: number; unreadAfter: number | null };
};

export const channelQueries = {
  all: () => ["channels"] as const,
  listKey: () => [...channelQueries.all(), "list"] as const,
  list: () =>
    queryOptions({
      queryKey: channelQueries.listKey(),
      queryFn: listChannels,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
  details: () => [...channelQueries.all(), "detail"] as const,
  detail: (channelId: string) =>
    queryOptions({
      queryKey: [...channelQueries.details(), channelId] as const,
      queryFn: streamedQuery<ChannelObservationEvent, ChannelQueryData | null>({
        initialValue: null,
        refetchMode: "append",
        streamFn: async function* ({ client, queryKey, signal }) {
          const cached = client.getQueryData<ChannelQueryData | null>(queryKey);
          for await (const event of streamChannel(channelId, signal, cached?.revision)) {
            if (event.type === "deleted") removeChannelFromList(client, channelId);
            yield event;
          }
        },
        reducer: (previous, event) => {
          if (event.type === "deleted") return null;
          const state = reduceChannelState(previous!, event);
          const arrived = event.type === "snapshot" || event.type === "resumed";
          const { seenThrough, latestSequence } = state.channel;
          return {
            ...state,
            arrival: arrived
              ? {
                  id: (previous?.arrival.id ?? 0) + 1,
                  unreadAfter: seenThrough < latestSequence ? seenThrough : null,
                }
              : previous!.arrival,
          };
        },
      }),
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (_count, error) =>
        !(error instanceof ChannelStreamError && error.status < 500 && error.status !== 429),
      retryDelay: 1_000,
    }),
  messagesBefore: (channelId: string, beforeSequence: number) =>
    queryOptions({
      queryKey: [...channelQueries.details(), channelId, "before", beforeSequence] as const,
      queryFn: async ({ signal }) => {
        const response = await fetch(
          `/api/v1/channels/${encodeURIComponent(channelId)}/messages?before=${beforeSequence}`,
          { signal },
        );
        if (!response.ok) throw new Error("Unable to load Channel history.");
        return response.json() as Promise<{ revision: number; messages: ChannelMessage[] }>;
      },
      staleTime: 0,
      gcTime: 0,
    }),
};
