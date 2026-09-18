import { queryOptions } from "@tanstack/react-query";
import { listAgents } from "@agents/server/functions";

export const agentQueries = {
  all: () => ["agents"] as const,
  listKey: () => [...agentQueries.all(), "list"] as const,
  list: () =>
    queryOptions({
      queryKey: agentQueries.listKey(),
      queryFn: listAgents,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
