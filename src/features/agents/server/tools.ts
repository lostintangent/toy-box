import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  agentHandleFromName,
  createAgentInputSchema,
  manageAgentExperienceInputSchema,
  selfUpdateAgentInputSchema,
  type AgentHost,
} from "@agents/model";

const updateAgentTool = defineTool("update_agent", {
  description:
    "Establishes or updates this persistent Agent's persona, avatar, or both. Use for first-engagement onboarding or durable identity changes.",
  parameters: selfUpdateAgentInputSchema,
  skipPermission: true,
  handler: async (args, invocation) => {
    const { updateCurrentAgent } = await import("@agents/server/runtime");
    return JSON.stringify(await updateCurrentAgent(invocation.sessionId, args));
  },
});

const manageAgentExperienceTool = defineTool("manage_agent_experience", {
  description:
    "Adds, updates, or deletes one durable cross-project experience: a preference, workflow, collaboration lesson, or reusable heuristic.",
  parameters: manageAgentExperienceInputSchema,
  skipPermission: true,
  handler: async (args, invocation) => {
    const { manageCurrentAgentExperience } = await import("@agents/server/runtime");
    return JSON.stringify(await manageCurrentAgentExperience(invocation.sessionId, args));
  },
});

const finishAgentTurnTool = defineTool("finish_agent_turn", {
  description:
    "Ends this private Agent turn without publishing a message. Finish any host work before calling.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  isTerminal: true,
  handler: () => "Done.",
});

export const listAgentsTool = defineTool("list_available_agents", {
  description: "Lists available Agents with their stable IDs, exact mentions, and personas.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  handler: async () => {
    const { listAgents } = await import("@agents/server");
    return JSON.stringify(
      (await listAgents()).map(({ id, name, persona }) => ({
        agentId: id,
        name,
        mention: `@${agentHandleFromName(name)}`,
        persona,
      })),
    );
  },
});

export const createAgentTool = defineTool("create_agent", {
  description:
    "Creates a persistent Agent identity with a unique name and optional initial persona. Use list_available_agents first. Creation does not invite the Agent; its first mention on a host onboards any missing persona and avatar.",
  parameters: createAgentInputSchema,
  skipPermission: true,
  handler: async (input) => {
    const { createAgent } = await import("@agents/server");
    const agent = await createAgent(input);
    return JSON.stringify({ agent, mention: `@${agentHandleFromName(agent.name)}` });
  },
});

export function getAgentMembershipTools(kind: AgentHost["kind"]) {
  return [
    finishAgentTurnTool,
    updateAgentTool,
    manageAgentExperienceTool,
    ...(kind === "channel" ? [listAgentsTool] : []),
  ];
}
