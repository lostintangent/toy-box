import type { ChannelAgent, ChannelConversationMessage, ChannelReaction } from ".";
import type { ChannelAgentPresence } from "./presence";

/** A reaction as a message shows it: recorded, or projected from a working agent's activity. */
export type ChannelMessageReaction = {
  agentId: string;
  reaction: ChannelReaction["reaction"] | "looking" | "working";
};

/** A message's recorded reactions, plus the working agents looking at or acting on it. */
export function channelMessageReactions(
  message: Pick<ChannelConversationMessage, "sequence" | "reactions">,
  agents: readonly Pick<ChannelAgent, "id" | "status">[],
  presence: Readonly<Record<string, ChannelAgentPresence>>,
): ChannelMessageReaction[] {
  const reactions: ChannelMessageReaction[] = [...(message.reactions ?? [])];
  for (const agent of agents) {
    if (presence[agent.id]?.state !== "working" || agent.status?.state !== "working") continue;
    if (agent.status.lookingAt === message.sequence) {
      reactions.push({ agentId: agent.id, reaction: "looking" });
    }
    if (agent.status.workingOn === message.sequence) {
      reactions.push({ agentId: agent.id, reaction: "working" });
    }
  }
  return reactions;
}
