import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  updateAutomation,
} from "./server/functions";
import { invalidateSessionQueries, recreateSessionInCache } from "@sessions/queryCache";
import { applyWorkspaceEvent, workspaceQueries } from "@workspace/queries";
import { isWorkspaceSessionLive, type WorkspaceState } from "@workspace/model/state/reducer";
import type { Automation, AutomationOptions } from "./model";

export const automationMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: AutomationOptions) => createAutomation({ data: input }),
      onSuccess: (automation, _variables, _onMutateResult, { client }) => {
        cacheAutomation(client, automation);
      },
    }),

  update: (automationId: string) =>
    mutationOptions({
      mutationFn: (input: AutomationOptions) =>
        updateAutomation({ data: { automationId, ...input } }),
      onSuccess: (automation, _variables, _onMutateResult, { client }) => {
        cacheAutomation(client, automation);
      },
    }),

  delete: (automationId: string) =>
    mutationOptions({
      mutationFn: () => deleteAutomation({ data: { automationId } }),
      onSuccess: (_deleted, _variables, _onMutateResult, { client }) => {
        removeAutomation(client, automationId);
      },
    }),

  run: (automation: Automation) =>
    mutationOptions({
      mutationFn: (clientId: string) =>
        runAutomation({ data: { automationId: automation.id, clientId } }),
      onMutate: (clientId, { client }) => {
        const status = client.getQueryData<WorkspaceState>(workspaceQueries.stateKey())
          ?.sessionStates[automation.id]?.status;
        if (isWorkspaceSessionLive(status)) return;

        return recreateSessionInCache(
          client,
          automation.id,
          { clientId, content: automation.prompt, model: automation.model },
          { title: automation.title, sessionType: "automation" },
        );
      },
      onSettled: (_result, _error, _variables, _onMutateResult, { client }) =>
        invalidateSessionQueries(client, automation.id),
    }),
};

function cacheAutomation(client: QueryClient, automation: Automation) {
  applyWorkspaceEvent(client, { type: "automation.upserted", automation });
}

function removeAutomation(client: QueryClient, automationId: string) {
  // The definition owns the stable managed session with the same ID.
  applyWorkspaceEvent(client, { type: "session.deleted", sessionId: automationId });
  applyWorkspaceEvent(client, { type: "automation.deleted", automationId });
}
