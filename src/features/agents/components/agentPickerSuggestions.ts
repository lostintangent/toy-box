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

/** Group matching Agents by Channel membership. */
export function agentPickerSuggestions({
  query,
  agents,
  memberships,
}: {
  query: string;
  agents: readonly Agent[];
  memberships: readonly Pick<AgentMembership, "agentId">[];
}): AgentPickerSuggestion[] {
  const memberAgentIds = new Set(memberships.map(({ agentId }) => agentId));
  const matchingAgents = agents.filter((agent) => agentMatchesMentionQuery(agent, query));
  const suggestions: AgentPickerSuggestion[] = [];
  for (const isMember of [true, false]) {
    for (const agent of matchingAgents) {
      if (memberAgentIds.has(agent.id) !== isMember) continue;
      suggestions.push(
        suggestionForAgent(agent, isMember ? "In this channel" : "Invite to channel"),
      );
    }
  }
  return suggestions;
}

function suggestionForAgent(agent: Agent, group: string): AgentPickerSuggestion {
  return {
    handle: agentHandleFromName(agent.name),
    name: agent.name,
    description: agent.persona ?? "Onboards during the first engagement",
    group,
    agentId: agent.id,
    ...(agent.avatar ? { avatar: agent.avatar } : {}),
  };
}
