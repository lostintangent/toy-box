import { mutationOptions } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  updateAutomation,
} from "./server/functions";
import { optimisticMutation } from "@workspace/sync";
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
    optimisticMutation({ type: "automation.deleted", automationId }, () =>
      deleteAutomation({ data: { automationId } }),
    ),

  run: () =>
    mutationOptions({
      mutationFn: (automationId: string) => runAutomation({ data: { automationId } }),
    }),
};
