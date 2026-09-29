import {
  agentHandleFromName,
  agentMatchesMentionQuery,
  type AgentAvatar,
  type ChannelLead,
  type ChannelMember,
} from "@channels/model";

export type AgentPickerSuggestion = {
  handle: string;
  name: string;
  description: string;
  group: string;
  avatar?: AgentAvatar;
  agent?: ChannelMember;
  kind?: "everyone" | "create";
};

/** Suggest everyone, the lead, then the Channel's members that match a mention query. */
export function agentPickerSuggestions(
  query: string,
  lead: ChannelLead,
  members: readonly ChannelMember[],
): AgentPickerSuggestion[] {
  const suggestions: AgentPickerSuggestion[] = [];
  if ("everyone".includes(query.toLowerCase())) {
    suggestions.push({
      handle: "everyone",
      name: "Everyone",
      description: "Wake everyone in the channel",
      group: "Channel",
      kind: "everyone",
    });
  }
  if (agentMatchesMentionQuery(lead, query)) {
    suggestions.push({
      handle: agentHandleFromName(lead.name),
      name: lead.name,
      description: lead.role,
      group: "Channel",
      avatar: lead.avatar,
    });
  }
  return [
    ...suggestions,
    ...members
      .filter((agent) => agentMatchesMentionQuery(agent, query))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(suggestionForAgent),
  ];
}

function suggestionForAgent(agent: ChannelMember): AgentPickerSuggestion {
  return {
    handle: agentHandleFromName(agent.name),
    name: agent.name,
    description: agent.role ?? "Onboarding",
    group: "In this channel",
    ...(agent.avatar ? { avatar: agent.avatar } : {}),
    agent,
  };
}
