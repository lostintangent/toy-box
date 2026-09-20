import { agentHandleFromName, agentMatchesMentionQuery, type ChannelMember } from "@channels/model";

export type AgentPickerSuggestion = {
  handle: string;
  name: string;
  description: string;
  group: string;
  agent?: ChannelMember;
  kind?: "everyone" | "create";
};

/** Suggest matching agents from the current Channel. */
export function agentPickerSuggestions(
  query: string,
  members: readonly ChannelMember[],
): AgentPickerSuggestion[] {
  return members
    .filter((agent) => agentMatchesMentionQuery(agent, query))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(suggestionForAgent);
}

function suggestionForAgent(agent: ChannelMember): AgentPickerSuggestion {
  return {
    handle: agentHandleFromName(agent.name),
    name: agent.name,
    description: agent.role ?? "Onboards during the first engagement",
    group: "In this channel",
    agent,
  };
}
