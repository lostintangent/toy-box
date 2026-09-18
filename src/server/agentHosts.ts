// Application composition for the Channel host persistent Agents can join.
// Agents owns the interface; Channels owns its adapter.

import type { AgentHostAdapter } from "@agents/server/host";

export async function getAgentHostAdapter(): Promise<AgentHostAdapter> {
  return (await import("@channels/server/agentHost")).channelAgentHost;
}
