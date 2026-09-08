// Application composition for the hosts persistent Agents can join.
// Agents owns the interface; Sessions, Channels, and Files own their adapters.

import type { AgentHost } from "@agents/model";
import type { AgentHostAdapter } from "@agents/server/host";

export async function getAgentHostAdapter(host: AgentHost): Promise<AgentHostAdapter> {
  switch (host.kind) {
    case "session":
      return (await import("@sessions/server/agentHost")).sessionAgentHost;
    case "channel":
      return (await import("@channels/server/agentHost")).channelAgentHost;
    case "file":
      return (await import("@files/server/agentHost")).fileAgentHost;
  }
}
