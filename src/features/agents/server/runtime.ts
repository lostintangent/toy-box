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
  const onboardingProcess =
    !agent.persona && !agent.avatar
      ? "This is your first engagement. Before finishing, use update_agent once. Establish a concise, durable persona and design a distinctive avatar that reflects how you contribute."
      : !agent.persona
        ? "Before finishing, use update_agent to establish a concise, durable persona that reflects how you contribute."
        : !agent.avatar
          ? "Before finishing, use update_agent to design a distinctive avatar that reflects your established persona."
          : undefined;
  return `<your_identity>
You are ${agent.name} (@${agentHandleFromName(agent.name)}), a persistent Toy Box agent.

Persona:
${agent.persona ?? "Not established yet."}

Avatar: ${avatarText}

Experiences:
${experienceText}

Your identity and experiences persist across channels where you are invited. Use update_agent when your durable identity changes. Use manage_agent_experience for durable cross-project preferences, workflows, collaboration lessons, or heuristics. Revise overlapping experiences. Keep project knowledge in its documentation, AGENTS.md, or skills.
</your_identity>

${onboardingProcess ? `<onboarding_process>\n${onboardingProcess}\n</onboarding_process>\n\n` : ""}<collaboration_protocol>
${hostInstructions}

Write public messages like you speak to a colleague. Match the user's tone, not another agent's. Use ordinary conversational openings and transitions. Say “I found one issue” rather than announcing a report label or verdict. Avoid compressed report prose. Keep only useful detail, using short paragraphs, Markdown lists, or code when they improve readability. Skip self-introductions, private narration, and repetition. Never use em dashes or semicolons.
</collaboration_protocol>`;
}

export async function updateCurrentAgent(
  sessionId: string,
  input: SelfUpdateAgentInput,
): Promise<Agent> {
  const resolved = await resolveAgentMembership(sessionId);
  if (!resolved) throw new Error("This Session is not bound to a persistent Agent.");
  const database = await getStateDatabase();
  const agents = new AgentDatabase(database);
  const agent = await agents.selfUpdateAgent(resolved.agent.id, input);
  if (!agent) throw new Error("Agent not found.");
  broadcast({ type: "agent.changed" });
  return agent;
}

export async function manageCurrentAgentExperience(
  sessionId: string,
  input: ManageAgentExperienceInput,
): Promise<Agent> {
  const resolved = await resolveAgentMembership(sessionId);
  if (!resolved) throw new Error("This Session is not bound to a persistent Agent.");
  const database = await getStateDatabase();
  const agents = new AgentDatabase(database);
  const agent = await agents.manageExperience(resolved.agent.id, input);
  if (!agent) throw new Error("Agent not found.");
  broadcast({ type: "agent.changed" });
  return agent;
}

export async function finishCurrentAgentTurn(
  sessionId: string,
  waitingFor?: string,
): Promise<void> {
  const resolved = await resolveAgentMembership(sessionId);
  if (!resolved) throw new Error("This Session is not bound to a persistent Agent.");
  const adapter = await (await import("@/server/agentHosts")).getAgentHostAdapter();
  await adapter.finishTurn?.(resolved.agent, resolved.membership, waitingFor);
}
