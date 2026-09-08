import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import type {
  CreateAgentInput,
  ManageAgentExperienceRequest,
  UpdateAgentInput,
} from "@agents/model";
import {
  createAgent,
  deleteAgent,
  manageAgentExperience,
  updateAgent,
} from "@agents/server/functions";
import { agentQueries } from "@agents/queries";

const refreshAgents = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: agentQueries.listKey(), exact: true });

export const agentMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: CreateAgentInput) => createAgent({ data: input }),
      onSuccess: (_agent, _input, _result, { client }) => refreshAgents(client),
    }),
  update: () =>
    mutationOptions({
      mutationFn: (input: UpdateAgentInput) => updateAgent({ data: input }),
      onSuccess: (_agent, _input, _result, { client }) => refreshAgents(client),
    }),
  delete: (agentId: string) =>
    mutationOptions({
      mutationFn: () => deleteAgent({ data: { agentId } }),
      onSuccess: (_deleted, _input, _result, { client }) => refreshAgents(client),
    }),
  manageExperience: () =>
    mutationOptions({
      mutationFn: (input: ManageAgentExperienceRequest) => manageAgentExperience({ data: input }),
      onSuccess: (_agent, _input, _result, { client }) => refreshAgents(client),
    }),
};
