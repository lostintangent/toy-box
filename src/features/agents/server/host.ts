import type { Tool } from "@sessions/server/tools/definition";
import type { Agent, AgentMembership } from "@agents/model";

/** Agents owns this host interface and supervision; each host supplies its
 * public instructions, tools, and host-specific membership lifecycle. */
export type AgentHostAdapter = {
  getInstructions: (agent: Agent, membership: AgentMembership) => Promise<string>;
  /** Host-specific capabilities exposed to its private Agent Session. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTools?: () => Tool<any>[];
  /** Hosts with additional membership state own atomic Agent admission. */
  admitAgent?: (agent: Agent, membership: AgentMembership) => Promise<void>;
  /** Hosts with additional membership state override default Agent removal. */
  removeAgent?: (agent: Agent, membership: AgentMembership) => Promise<void>;
  /** Hosts may settle public membership state when a private turn starts. */
  startTurn?: (agent: Agent, membership: AgentMembership) => Promise<void>;
  /** Hosts may settle public membership state when a private turn finishes. */
  finishTurn?: (agent: Agent, membership: AgentMembership, waitingFor?: string) => Promise<void>;
};
