import type { Agent, AgentMembership } from "@agents/model";

/** Agents owns this host interface and supervision; each host supplies its
 * public instructions and any admission or teardown beyond the base membership. */
export type AgentHostAdapter = {
  getInstructions: (agent: Agent, membership: AgentMembership) => Promise<string>;
  /** Hosts with additional membership state own atomic Agent admission. */
  admitAgent?: (agent: Agent, membership: AgentMembership) => Promise<void>;
  /** Hosts with additional membership state override default Agent removal. */
  removeAgent?: (agent: Agent, membership: AgentMembership) => Promise<void>;
};
