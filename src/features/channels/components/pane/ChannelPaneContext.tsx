import { createContext, useContext } from "react";
import type {
  ChannelAgent,
  ChannelAgentIdentity,
  ChannelLead,
  ChannelMember,
} from "@channels/model";
import type { ChannelAgentPresence } from "@channels/model/presence";

/** The open Channel's agents, and the drafts its transcript and overview start in the composer. */
type ChannelPane = {
  lead: ChannelLead;
  members: readonly ChannelMember[];
  /** The lead, then the members. */
  agents: readonly ChannelAgent[];
  /** The agent with this ID, or a deleted identity once it has left. */
  agent: (id: string) => ChannelAgentIdentity;
  presence: Record<string, ChannelAgentPresence>;
  /** Addresses the draft to an agent by mentioning it first. */
  reply: (agent: ChannelAgent) => void;
  /** Posts a suggested reply to the pending request as the user's next message. */
  answer: (content: string) => void;
  /** Begins a mention, so the picker can address or add an agent. */
  mention: () => void;
};

const ChannelPaneContext = createContext<ChannelPane | undefined>(undefined);

export const ChannelPaneProvider = ChannelPaneContext.Provider;

/** The open Channel's roster, available from the first render, as the lead is intrinsic. */
export function useChannelPane(): ChannelPane {
  const pane = useContext(ChannelPaneContext);
  if (!pane) throw new Error("Channel content must be rendered within a Channel pane.");
  return pane;
}
