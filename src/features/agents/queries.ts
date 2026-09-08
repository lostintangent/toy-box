import { queryOptions } from "@tanstack/react-query";
import { agentHostId, type AgentHost } from "@agents/model";
import { listAgentMemberships, listAgents } from "@agents/server/functions";

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
  memberships: () => [...agentQueries.all(), "memberships"] as const,
  membershipList: (host: AgentHost) =>
    queryOptions({
      queryKey: [...agentQueries.memberships(), host.kind, agentHostId(host)] as const,
      queryFn: () => listAgentMemberships({ data: { host } }),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
