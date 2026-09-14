import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  agentHandleFromName,
  agentMembershipStatusSchema,
  createAgentInputSchema,
  manageAgentExperienceInputSchema,
  selfUpdateAgentInputSchema,
  type AgentHost,
} from "@agents/model";

const updateAgentTool = defineTool("update_agent", {
  description: "Updates this persistent agent's persona, avatar, or both.",
  parameters: selfUpdateAgentInputSchema,
  skipPermission: true,
  handler: async (args, invocation) => {
    const { updateCurrentAgent } = await import("@agents/server/runtime");
    return JSON.stringify(await updateCurrentAgent(invocation.sessionId, args));
  },
});

const manageAgentExperienceTool = defineTool("manage_agent_experience", {
  description: "Adds, updates, or deletes one durable cross-project experience.",
  parameters: manageAgentExperienceInputSchema,
  skipPermission: true,
  handler: async (args, invocation) => {
    const { manageCurrentAgentExperience } = await import("@agents/server/runtime");
    return JSON.stringify(await manageCurrentAgentExperience(invocation.sessionId, args));
  },
});

const finishAgentTurnTool = defineTool("finish_agent_turn", {
  description: "Ends this private agent turn without publishing a message.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  isTerminal: true,
  handler: () => "Done.",
});

const finishChannelAgentTurnTool = defineTool("finish_agent_turn", {
  description:
    "Ends this private agent turn and clears its active channel status. waitingFor leaves a brief waiting status.",
  parameters: z
    .object({
      waitingFor: agentMembershipStatusSchema.shape.text
        .optional()
        .describe("What this agent is waiting for after the turn ends."),
    })
    .strict(),
  skipPermission: true,
  isTerminal: true,
  handler: async ({ waitingFor }, invocation) => {
    const { finishCurrentAgentTurn } = await import("@agents/server/runtime");
    await finishCurrentAgentTurn(invocation.sessionId, waitingFor);
    return "Done.";
  },
});

export const listAgentsTool = defineTool("list_available_agents", {
  description: "Lists available agents with their stable IDs, exact mentions, and personas.",
  parameters: z.object({}).strict(),
  skipPermission: true,
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
  skipPermission: true,
  handler: async (input) => {
    const { createAgent } = await import("@agents/server");
    const agent = await createAgent(input);
    return JSON.stringify({ agent, mention: `@${agentHandleFromName(agent.name)}` });
  },
});

export function getAgentMembershipTools(kind: AgentHost["kind"]) {
  return [
    kind === "channel" ? finishChannelAgentTurnTool : finishAgentTurnTool,
    updateAgentTool,
    manageAgentExperienceTool,
    ...(kind === "channel" ? [listAgentsTool] : []),
  ];
}
