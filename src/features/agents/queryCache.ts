import type { QueryClient } from "@tanstack/react-query";
import { agentQueries } from "@agents/queries";
import type { WorkspaceEvent } from "@workspace/model/events";

export function applyAgentEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  switch (event.type) {
    case "agent.changed":
      void queryClient.invalidateQueries({ queryKey: agentQueries.listKey(), exact: true });
      return;
    case "agent.membership.changed":
      void queryClient.invalidateQueries({
        queryKey: agentQueries.membershipList(event.host).queryKey,
        exact: true,
      });
      return;
    default:
      return;
  }
}

export function invalidateAgentQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: agentQueries.all() });
}
