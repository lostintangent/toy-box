import type {
  Agent,
  AgentMembership,
  AgentHost,
  CreateAgentInput,
  ManageAgentExperienceRequest,
  UpdateAgentInput,
} from "@agents/model";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";
import { AgentDatabase } from "./database";

export async function listAgents(): Promise<Agent[]> {
  return new AgentDatabase(await getStateDatabase()).listAgents();
}

/** Trusted server-side lookup used by features that host an Agent. */
export async function getAgent(agentId: string): Promise<Agent | null> {
  return new AgentDatabase(await getStateDatabase()).getAgent(agentId);
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const agent = await new AgentDatabase(await getStateDatabase()).createAgent(input);
  broadcast({ type: "agent.changed" });
  return agent;
}

export async function updateAgent(input: UpdateAgentInput): Promise<Agent> {
  const agent = await new AgentDatabase(await getStateDatabase()).updateAgent(input);
  if (!agent) throw new Error("Agent not found.");
  broadcast({ type: "agent.changed" });
  return agent;
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  const database = new AgentDatabase(await getStateDatabase());
  // A membership's private Session is its owned runtime resource. Session
  // teardown removes the membership and any host projection before identity deletion.
  const { deleteSessionIfExists } = await import("@sessions/server/runtime");
  for (const sessionId of await database.listAgentMembershipSessionIds(agentId)) {
    await deleteSessionIfExists(sessionId);
  }

  const deleted = await database.deleteAgent(agentId);
  if (deleted) broadcast({ type: "agent.changed" });
  return deleted;
}

export async function manageAgentExperience(
  agentId: string,
  change: ManageAgentExperienceRequest["change"],
): Promise<Agent> {
  const agents = new AgentDatabase(await getStateDatabase());
  const agent = await agents.manageExperience(agentId, change);
  if (!agent) throw new Error("Agent not found.");
  broadcast({ type: "agent.changed" });
  return agent;
}

export async function listAgentMemberships(host: AgentHost): Promise<AgentMembership[]> {
  return new AgentDatabase(await getStateDatabase()).listMemberships(host);
}

export async function listAgentSessionIds(): Promise<string[]> {
  const database = await getStateDatabase({ createIfMissing: false });
  return database ? new AgentDatabase(database).listAgentSessionIds() : [];
}

export async function listSessionOwnedAgentSessionIds(sessionId: string): Promise<string[]> {
  const database = await getStateDatabase({ createIfMissing: false });
  return database
    ? new AgentDatabase(database).listSessionOwnedMembershipSessionIds(sessionId)
    : [];
}
