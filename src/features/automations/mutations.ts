import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  updateAutomation,
} from "./server/functions";
import { addSessionIfMissing } from "@sessions/queryCache";
import { sessionQueries } from "@sessions/queries";
import { applyWorkspaceEvent, workspaceQueries } from "@workspace/queries";
import type { WorkspaceState } from "@workspace/model/state/reducer";
import type { SessionSnapshot } from "@sessions/model";
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

  run: (automationId: string) =>
    mutationOptions({
      mutationFn: () => runAutomation({ data: { automationId } }),
      onSuccess: ({ sessionId, started }, _variables, _onMutateResult, { client }) => {
        if (!started) return;

        const automation = client
          .getQueryData<WorkspaceState>(workspaceQueries.stateKey())
          ?.automations.find((candidate) => candidate.id === automationId);
        client.setQueryData<SessionSnapshot>(sessionQueries.detail(sessionId).queryKey, {
          id: sessionId,
          messages: [],
          queuedMessages: [],
          model: automation?.model,
          status: "thinking",
          reasoningContent: "",
        });
        addSessionIfMissing(client, {
          sessionId,
          startTime: new Date(),
          modifiedTime: new Date(),
          summary: automation?.title ?? "",
          isRemote: false,
        });
      },
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
