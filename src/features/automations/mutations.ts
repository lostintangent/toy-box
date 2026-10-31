import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  updateAutomation,
} from "./server/functions";
import {
  invalidateSessionQueries,
  invalidateSessionsStateQuery,
  recreateSessionInCache,
} from "@sessions/cache";
import { isLiveActivity, type SessionsActivity } from "@sessions/model/activity";
import { sessionQueries } from "@sessions/queries";
import { applyWorkspaceEvent } from "@workspace/sync";
import type { Automation, AutomationOptions } from "./model";
import { invalidateAutomationListQuery } from "./cache";

export const automationMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: AutomationOptions) => createAutomation({ data: input }),
      onSuccess: (_automation, _variables, _onMutateResult, { client }) =>
        Promise.all([invalidateAutomationListQuery(client), invalidateSessionsStateQuery(client)]),
    }),

  update: (automationId: string) =>
    mutationOptions({
      mutationFn: (input: AutomationOptions) =>
        updateAutomation({ data: { automationId, ...input } }),
      onSuccess: (_automation, _variables, _onMutateResult, { client }) =>
        invalidateAutomationListQuery(client),
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
        const status = client.getQueryData<SessionsActivity>(sessionQueries.activityKey())?.[
          automation.id
        ]?.status;
        if (isLiveActivity(status)) return;

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

function removeAutomation(client: QueryClient, automationId: string) {
  // The definition owns the stable managed session with the same ID.
  applyWorkspaceEvent(client, { type: "session.deleted", sessionId: automationId });
  applyWorkspaceEvent(client, { type: "automation.deleted", automationId });
}
