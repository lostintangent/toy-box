import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  updateAutomation,
} from "./server/functions";
import { applyWorkspaceEvent } from "@workspace/sync";
import type { AutomationOptions } from "./model";

export const automationMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: AutomationOptions) => createAutomation({ data: input }),
    }),

  update: (automationId: string) =>
    mutationOptions({
      mutationFn: (input: AutomationOptions) =>
        updateAutomation({ data: { automationId, ...input } }),
    }),

  delete: (automationId: string) =>
    mutationOptions({
      mutationFn: () => deleteAutomation({ data: { automationId } }),
      onSuccess: (_deleted, _variables, _onMutateResult, { client }) => {
        removeAutomation(client, automationId);
      },
    }),

  run: () =>
    mutationOptions({
      mutationFn: (automationId: string) => runAutomation({ data: { automationId } }),
    }),
};

function removeAutomation(client: QueryClient, automationId: string) {
  // The definition owns the stable managed session with the same ID.
  applyWorkspaceEvent(client, { type: "session.deleted", sessionId: automationId });
  applyWorkspaceEvent(client, { type: "automation.deleted", automationId });
}
