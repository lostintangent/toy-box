import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAutomation as createAutomationOnServer,
  deleteAutomation as deleteAutomationOnServer,
  runAutomation as runAutomationOnServer,
  updateAutomation as updateAutomationOnServer,
} from "@/functions/automations";
import { sessionQueries } from "@/lib/queries";
import { addSessionIfMissing } from "@/lib/session/queryCache";
import { applyWorkspaceEvent, workspaceQueries } from "@/lib/workspace/state/query";
import type { WorkspaceState } from "@/lib/workspace/state/reducer";
import type { Automation, AutomationOptions, SessionSnapshot } from "@/types";

/** Automation commands and their client-side cache effects. */
export function useAutomationActions() {
  const queryClient = useQueryClient();

  function cacheAutomation(automation: Automation) {
    applyWorkspaceEvent(queryClient, { type: "automation.upserted", automation });
  }

  const createMutation = useMutation({
    mutationFn: (input: AutomationOptions) => createAutomationOnServer({ data: input }),
    onSuccess: cacheAutomation,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: AutomationOptions & { automationId: string }) => {
      const automation = await updateAutomationOnServer({ data: input });
      if (!automation) throw new Error("Automation not found");
      return automation;
    },
    onSuccess: cacheAutomation,
  });

  const deleteMutation = useMutation({
    mutationFn: async (automationId: string) => {
      const deleted = await deleteAutomationOnServer({ data: { automationId } });
      if (!deleted) throw new Error("Automation not found");
      return automationId;
    },
    onSuccess: (automationId) => {
      // The definition owns the stable session with the same ID.
      applyWorkspaceEvent(queryClient, { type: "session.deleted", sessionId: automationId });
      applyWorkspaceEvent(queryClient, { type: "automation.deleted", automationId });
    },
  });

  const runMutation = useMutation({
    mutationFn: (automationId: string) => runAutomationOnServer({ data: { automationId } }),
    onSuccess: ({ sessionId, started }, automationId) => {
      if (!started) return;

      const automation = queryClient
        .getQueryData<WorkspaceState>(workspaceQueries.stateKey())
        ?.automations.find((candidate) => candidate.id === automationId);
      queryClient.setQueryData<SessionSnapshot>(sessionQueries.detail(sessionId).queryKey, {
        id: sessionId,
        messages: [],
        queuedMessages: [],
        model: automation?.model,
        status: "thinking",
        reasoningContent: "",
      });
      addSessionIfMissing(queryClient, {
        sessionId,
        startTime: new Date(),
        modifiedTime: new Date(),
        summary: automation?.title ?? "",
        isRemote: false,
      });
    },
  });

  const updatingAutomationId = updateMutation.isPending
    ? (updateMutation.variables?.automationId ?? null)
    : null;
  const deletingAutomationId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null;

  async function createAutomation(input: AutomationOptions): Promise<void> {
    await createMutation.mutateAsync(input);
  }

  async function updateAutomation(
    input: AutomationOptions & { automationId: string },
  ): Promise<void> {
    await updateMutation.mutateAsync(input);
  }

  async function deleteAutomation(automationId: string): Promise<void> {
    await deleteMutation.mutateAsync(automationId);
  }

  async function runAutomation(automationId: string): Promise<string> {
    return (await runMutation.mutateAsync(automationId)).sessionId;
  }

  return {
    createAutomation,
    updateAutomation,
    deleteAutomation,
    runAutomation,
    isCreatingAutomation: createMutation.isPending,
    updatingAutomationId,
    deletingAutomationId,
  };
}
