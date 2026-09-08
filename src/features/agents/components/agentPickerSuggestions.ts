import {
  agentHandleFromName,
  agentMatchesMentionQuery,
  type Agent,
  type AgentAvatar,
  type AgentMembership,
} from "@agents/model";

export type AgentPickerSuggestion = {
  handle: string;
  name: string;
  description: string;
  group: string;
  agentId?: string;
  avatar?: AgentAvatar;
  kind?: "everyone" | "create";
};

/** Group matching Agents by existing membership or invitation. */
export function agentPickerSuggestions({
  query,
  agents,
  memberships,
  hostKind,
}: {
  query: string;
  agents: readonly Agent[];
  memberships: readonly Pick<AgentMembership, "agentId">[];
  hostKind: "session" | "channel";
}): AgentPickerSuggestion[] {
  const memberAgentIds = new Set(memberships.map(({ agentId }) => agentId));
  const matchingAgents = agents.filter((agent) => agentMatchesMentionQuery(agent, query));
  const suggestions: AgentPickerSuggestion[] = [];
  for (const isMember of [true, false]) {
    for (const agent of matchingAgents) {
      if (memberAgentIds.has(agent.id) !== isMember) continue;
      suggestions.push({
        handle: agentHandleFromName(agent.name),
        name: agent.name,
        description: agent.persona ?? "Onboards during the first engagement",
        group: isMember ? `In this ${hostKind}` : `Invite to ${hostKind}`,
        agentId: agent.id,
        ...(agent.avatar ? { avatar: agent.avatar } : {}),
      });
    }
  }
  return suggestions;
}
