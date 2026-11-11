import { reduceChannelState } from "./model/reducer";
import { experimental_streamedQuery as streamedQuery, queryOptions } from "@tanstack/react-query";
import {
  channelUnreadAfter,
  type ChannelSubscriptionEvent,
  type ChannelState,
  type ChannelMessage,
} from "./model";
import { listChannels } from "@channels/server/functions";
import { reducedQuery } from "@/shared/query";
import { EventStreamError } from "@/shared/sse";
import { reduceChannelList } from "./model/catalog";
import { streamChannel } from "./stream";

/** Browser arrival is distinct from cached content and from later live updates. */
export type ChannelQueryData = ChannelState & {
  arrival: { id: number; unreadAfter: number | null };
};

export const channelQueries = {
  list: reducedQuery({
    queryKey: ["channels", "list"],
    fetch: ({ signal }) => listChannels({ signal }),
    reduce: reduceChannelList,
  }),
  detail: (channelId: string) =>
    queryOptions({
      queryKey: ["channels", "detail", channelId] as const,
      queryFn: streamedQuery<ChannelSubscriptionEvent, ChannelQueryData | null>({
        initialValue: null,
        refetchMode: "append",
        streamFn: ({ client, queryKey, signal }) =>
          streamChannel(
            channelId,
            signal,
            client.getQueryData<ChannelQueryData | null>(queryKey)?.revision,
          ),
        reducer: (previous, event) => {
          if (event.type === "deleted") return null;
          const state = reduceChannelState(previous!, event);
          const arrived = event.type === "snapshot" || event.type === "resumed";
          return {
            ...state,
            arrival: arrived
              ? {
                  id: (previous?.arrival.id ?? 0) + 1,
                  unreadAfter: channelUnreadAfter(state.channel),
                }
              : previous!.arrival,
          };
        },
      }),
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (_count, error) =>
        !(error instanceof EventStreamError && error.status < 500 && error.status !== 429),
      retryDelay: 1_000,
    }),
  messagesBefore: (channelId: string, beforeSequence: number) =>
    queryOptions({
      queryKey: ["channels", "detail", channelId, "before", beforeSequence] as const,
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
