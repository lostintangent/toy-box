import { defineTool } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  agentHandleFromName,
  createAgentInputSchema,
  manageAgentExperienceInputSchema,
  selfUpdateAgentInputSchema,
} from "@agents/model";

const updateAgentTool = defineTool("update_agent", {
  description: "Updates this persistent agent's persona, avatar, or both.",
  parameters: selfUpdateAgentInputSchema,
  handler: async (args, invocation) => {
    const { updateCurrentAgent } = await import("@agents/server/runtime");
    return JSON.stringify(await updateCurrentAgent(invocation.sessionId, args));
  },
});

const manageAgentExperienceTool = defineTool("manage_agent_experience", {
  description: "Adds, updates, or deletes one durable cross-project experience.",
  parameters: manageAgentExperienceInputSchema,
  handler: async (args, invocation) => {
    const { manageCurrentAgentExperience } = await import("@agents/server/runtime");
    return JSON.stringify(await manageCurrentAgentExperience(invocation.sessionId, args));
  },
});

export const listAgentsTool = defineTool("list_available_agents", {
  description: "Lists available agents with their stable IDs, exact mentions, and personas.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const { listAgentProfiles } = await import("@agents/server");
    return JSON.stringify(
      (await listAgentProfiles()).map(({ id, name, persona }) => ({
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
    "Creates a persistent agent identity with a unique name and optional initial persona. Use list_available_agents first. Creation does not invite the agent. Its first engagement onboards any missing persona and avatar.",
  parameters: createAgentInputSchema,
  handler: async (input) => {
    const { createAgent } = await import("@agents/server");
    const agent = await createAgent(input);
    return JSON.stringify({ agent, mention: `@${agentHandleFromName(agent.name)}` });
  },
});

export const agentSelfTools = [updateAgentTool, manageAgentExperienceTool];
