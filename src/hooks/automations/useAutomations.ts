import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  updateAutomation,
} from "@/functions/automations";
import { useServerEvents } from "@/hooks/events/useServerEvents";
import { applyAutomationEvent } from "@/lib/automation/queryCache";
import { automationQueries, sessionQueries, workspaceQueries } from "@/lib/queries";
import { addSessionIfMissing } from "@/lib/session/queryCache";
import type { AutomationEvent, AutomationOptions, SessionSnapshot, WorkspaceEvent } from "@/types";

export function useAutomations({
  onUserRunRequested,
  applyWorkspaceEvent,
}: {
  onUserRunRequested?: (sessionId: string) => void;
  applyWorkspaceEvent?: (event: WorkspaceEvent) => void;
} = {}) {
  const [updatingAutomationId, setUpdatingAutomationId] = useState<string | null>(null);
  const [deletingAutomationId, setDeletingAutomationId] = useState<string | null>(null);
  const { data: automations = [], isLoading } = useQuery(automationQueries.list());
  const queryClient = useQueryClient();

  function invalidateAutomations() {
    void queryClient.invalidateQueries({ queryKey: automationQueries.all() });
  }

  function handleServerEvent(event: AutomationEvent) {
    applyAutomationEvent(queryClient, event);
  }

  function handleServerOpen() {
    invalidateAutomations();
  }

  useServerEvents({
    topic: "automation",
    onEvent: handleServerEvent,
    onOpen: handleServerOpen,
  });

  const createMutation = useMutation({
    mutationFn: (input: AutomationOptions) => createAutomation({ data: input }),
    onSuccess: invalidateAutomations,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: AutomationOptions & { automationId: string }) => {
      const automation = await updateAutomation({ data: input });
      if (!automation) {
        throw new Error("Automation not found");
      }
      return automation;
    },
    onMutate: ({ automationId }) => {
      setUpdatingAutomationId(automationId);
    },
    onSettled: () => {
      setUpdatingAutomationId(null);
      invalidateAutomations();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (automationId: string) => {
      const deleted = await deleteAutomation({ data: { automationId } });
      if (!deleted) {
        throw new Error("Automation not found");
      }
      return deleted;
    },
    onMutate: (automationId) => {
      setDeletingAutomationId(automationId);
    },
    onSettled: () => {
      setDeletingAutomationId(null);
      invalidateAutomations();
    },
  });

  const runMutation = useMutation({
    mutationFn: (automationId: string) => runAutomation({ data: { automationId } }),
    onMutate: (automationId) => {
      applyWorkspaceEvent?.({ type: "session.creating", sessionId: automationId });
    },
    onSuccess: ({ sessionId, started }, automationId) => {
      // Reset the stable session cache while its new stream connects.
      if (started) {
        const automation = automations.find((candidate) => candidate.id === automationId);
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
      }

      onUserRunRequested?.(sessionId);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceQueries.stateKey() });
    },
    onSettled: () => {
      invalidateAutomations();
    },
  });

  return {
    automations,
    isLoading,
    createAutomation: async (input: AutomationOptions) => {
      await createMutation.mutateAsync(input);
    },
    updateAutomation: async (input: AutomationOptions & { automationId: string }) => {
      await updateMutation.mutateAsync(input);
    },
    deleteAutomation: async (automationId: string) => {
      await deleteMutation.mutateAsync(automationId);
    },
    runAutomation: async (automationId: string) => {
      await runMutation.mutateAsync(automationId);
    },
    isCreatingAutomation: createMutation.isPending,
    updatingAutomationId,
    deletingAutomationId,
  };
}
