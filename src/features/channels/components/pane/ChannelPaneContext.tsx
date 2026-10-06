import { createContext, useContext } from "react";
import type { ChannelAgent, ChannelLead, ChannelMember } from "@channels/model";
import type { ChannelAgentPresence } from "@channels/model/presence";

/** The open Channel's agents, and the drafts its transcript and overview start in the composer. */
type ChannelPane = {
  lead: ChannelLead;
  members: readonly ChannelMember[];
  /** The lead, then the members. */
  agents: readonly ChannelAgent[];
  presence: Record<string, ChannelAgentPresence>;
  /** Addresses the draft to an agent by mentioning it first. */
  reply: (agent: ChannelAgent) => void;
  /** Begins a mention, so the picker can address or add an agent. */
  mention: () => void;
};

const ChannelPaneContext = createContext<ChannelPane | undefined>(undefined);

export const ChannelPaneProvider = ChannelPaneContext.Provider;

export function useChannelPane(): ChannelPane {
  const pane = useContext(ChannelPaneContext);
  if (!pane) throw new Error("Channel content must be rendered within a Channel pane.");
  return pane;
}
