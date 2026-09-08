import { queryOptions } from "@tanstack/react-query";
import { getChannel, listChannels } from "@channels/server/functions";

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
      queryFn: () => getChannel({ data: { channelId } }),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    }),
};
