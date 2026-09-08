// Persistent identity, experiences, and instructions for private Agent Sessions.

import {
  agentHandleFromName,
  type Agent,
  type AgentMembership,
  type ManageAgentExperienceInput,
  type SelfUpdateAgentInput,
} from "@agents/model";
import { AgentDatabase } from "./database";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";

export async function resolveAgentMembership(
  sessionId: string,
): Promise<{ membership: AgentMembership; agent: Agent } | null> {
  const database = await getStateDatabase({ createIfMissing: false });
  if (!database) return null;
  const agents = new AgentDatabase(database);
  const membership = await agents.getMembershipBySession(sessionId);
  if (!membership) return null;

  const agent = await agents.getAgent(membership.agentId);
  if (!agent) return null;
  return { membership, agent };
}

export function buildAgentSystemInstructions(agent: Agent, hostInstructions: string): string {
  const experienceText =
    agent.experiences.length === 0
      ? "No durable cross-project experiences yet."
      : agent.experiences
          .map((experience) => `- ${experience.id}: ${experience.content}`)
          .join("\n");
  const avatarText = agent.avatar ? `${agent.avatar.color} self-authored mark` : "Not chosen yet.";
  const onboardingInstruction = !agent.persona
    ? "This is your first engagement. Before finishing, use update_agent once. Establish a concise, durable persona and design a distinctive avatar that reflects how you contribute."
    : !agent.avatar
      ? "Before finishing, use update_agent to design a distinctive avatar that reflects your established persona."
      : undefined;
  return `You are ${agent.name} (@${agentHandleFromName(agent.name)}), a persistent Toy Box Agent.

Persona:
${agent.persona ?? "Not established yet."}

Avatar: ${avatarText}

Experiences:
${experienceText}

${hostInstructions}

Your SDK transcript is private working state. Coordinate only through the host's public messages and artifacts.

In public replies, match the user's tone and level of detail. Sound like a thoughtful teammate, not a formal status report. Use plain, conversational language with focused sentences and short paragraphs. Never use em dashes or semicolons.

Your persona, avatar, and experiences travel with you across projects. Use update_agent when your durable identity evolves. When work reveals a durable cross-project preference, workflow, collaboration lesson, or reusable heuristic, use manage_agent_experience to retain it. Revise an overlapping experience instead of adding another. Project-specific knowledge belongs in project documentation, AGENTS.md, or a project skill.

${onboardingInstruction ? `${onboardingInstruction}\n\n` : ""}Once host work and any required identity onboarding are complete, use finish_agent_turn unless the host's reply tool already ended the turn. It publishes no message.`;
}

export async function updateCurrentAgent(
  sessionId: string,
  input: SelfUpdateAgentInput,
): Promise<Agent> {
  const database = await getStateDatabase();
  const agents = new AgentDatabase(database);
  const membership = await agents.getMembershipBySession(sessionId);
  if (!membership) throw new Error("This Session is not bound to a persistent Agent.");
  const agent = await agents.selfUpdateAgent(membership.agentId, input);
  if (!agent) throw new Error("Agent not found.");
  broadcast({ type: "agent.changed" });
  return agent;
}

export async function manageCurrentAgentExperience(
  sessionId: string,
  input: ManageAgentExperienceInput,
): Promise<Agent> {
  const database = await getStateDatabase();
  const agents = new AgentDatabase(database);
  const membership = await agents.getMembershipBySession(sessionId);
  if (!membership) throw new Error("This Session is not bound to a persistent Agent.");

  const agent = await agents.manageExperience(membership.agentId, input);
  if (!agent) throw new Error("Agent not found.");
  broadcast({ type: "agent.changed" });
  return agent;
}
