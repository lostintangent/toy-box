import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import type { Agent, AgentMembership } from "@agents/model";
import {
  createAgentInputSchema,
  deleteAgentInputSchema,
  listAgentMembershipsInputSchema,
  manageAgentExperienceRequestSchema,
  updateAgentInputSchema,
} from "@agents/model";
import * as agents from ".";

export const listAgents = createServerFn({ method: "GET" }).handler(
  (): Promise<Agent[]> => agents.listAgents(),
);

export const createAgent = createServerFn({ method: "POST" })
  .validator(zodValidator(createAgentInputSchema))
  .handler(({ data }): Promise<Agent> => agents.createAgent(data));

export const updateAgent = createServerFn({ method: "POST" })
  .validator(zodValidator(updateAgentInputSchema))
  .handler(({ data }): Promise<Agent> => agents.updateAgent(data));

export const deleteAgent = createServerFn({ method: "POST" })
  .validator(zodValidator(deleteAgentInputSchema))
  .handler(({ data }): Promise<boolean> => agents.deleteAgent(data.agentId));

export const manageAgentExperience = createServerFn({ method: "POST" })
  .validator(zodValidator(manageAgentExperienceRequestSchema))
  .handler(({ data }): Promise<Agent> => agents.manageAgentExperience(data.agentId, data.change));

export const listAgentMemberships = createServerFn({ method: "POST" })
  .validator(zodValidator(listAgentMembershipsInputSchema))
  .handler(({ data }): Promise<AgentMembership[]> => agents.listAgentMemberships(data.host));
