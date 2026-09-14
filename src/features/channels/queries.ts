import { queryOptions } from "@tanstack/react-query";
import {
  getChannelState,
  listChannelMessagesBefore,
  listChannels,
} from "@channels/server/functions";

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
      queryFn: () => getChannelState({ data: { channelId } }),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    }),
  messagesBefore: (channelId: string, beforeSequence: number) =>
    queryOptions({
      queryKey: [...channelQueries.details(), channelId, "before", beforeSequence] as const,
      queryFn: () => listChannelMessagesBefore({ data: { channelId, beforeSequence } }),
      gcTime: 0,
    }),
};
