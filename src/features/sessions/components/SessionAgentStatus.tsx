import { useQuery } from "@tanstack/react-query";
import { AgentStatus } from "@agents/components/AgentStatus";
import { agentQueries } from "@agents/queries";

/** Session-owned composition adapter around Agent-owned membership presentation. */
export function SessionAgentStatus({ sessionId }: { sessionId: string }) {
  const { data: memberships = [] } = useQuery(
    agentQueries.membershipList({ kind: "session", sessionId }),
  );
  const { data: agents } = useQuery(agentQueries.list());

  if (memberships.length === 0 || !agents) return null;

  return (
    <div className="flex flex-wrap gap-1 empty:hidden">
      <AgentStatus memberships={memberships} agents={agents} />
    </div>
  );
}
