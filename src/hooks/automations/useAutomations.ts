import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createServerAutomation,
  deleteServerAutomation,
  runServerAutomation,
  updateServerAutomation,
} from "@/functions/automations";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import { useServerEvents } from "@/hooks/events/useServerEvents";
import { applyAutomationsUpdateEvent } from "./cache";
import { getAutomationIdFromSessionId } from "@/lib/automation/sessionId";
import { automationQueries, sessionQueries } from "@/lib/queries";
import { prependSessionIfMissing } from "@/lib/session/sessionsCache";
import type { AutomationOptions, AutomationsUpdateEvent, SessionSnapshot } from "@/types";

type UseAutomationsOptions = {
  onUserRunRequested?: (sessionId: string) => void;
  streamingSessionIds?: string[];
};

/**
 * Provides automation state + actions for the UI by combining query data,
 * realtime automation events, and mutation handlers.
 */
export function useAutomations({
  onUserRunRequested,
  streamingSessionIds,
}: UseAutomationsOptions = {}) {
  const [updatingAutomationId, setUpdatingAutomationId] = useState<string | null>(null);
  const [deletingAutomationId, setDeletingAutomationId] = useState<string | null>(null);
  const [knownRunningAutomationIds, setKnownRunningAutomationIds] = useState<Set<string>>(
    new Set(),
  );

  const { data: automationsData, isLoading } = useQuery(automationQueries.list());

  const queryClient = useQueryClient();
  const isVisible = usePageVisibility();

  const automations = automationsData ?? [];

  const invalidateAutomations = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: automationQueries.all() });
  }, [queryClient]);

  const runningAutomationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const automationId of knownRunningAutomationIds) {
      ids.add(automationId);
    }

    for (const sessionId of streamingSessionIds ?? []) {
      const automationId = getAutomationIdFromSessionId(sessionId);
      if (!automationId) continue;
      ids.add(automationId);
    }

    return ids;
  }, [knownRunningAutomationIds, streamingSessionIds]);

  const handleServerEvent = useCallback(
    (event: AutomationsUpdateEvent) => {
      applyAutomationsUpdateEvent(queryClient, event);
      if (event.type === "automation.started") {
        setKnownRunningAutomationIds((current) => addAutomationId(current, event.automationId));
      }
      if (event.type === "automation.finished") {
        setKnownRunningAutomationIds((current) => removeAutomationId(current, event.automationId));
      }
    },
    [queryClient],
  );

  const handleServerReconnect = useCallback(() => {
    setKnownRunningAutomationIds((current) => (current.size === 0 ? current : new Set()));
    invalidateAutomations();
  }, [invalidateAutomations]);

  useEffect(() => {
    if (isVisible) return;
    setKnownRunningAutomationIds((current) => (current.size === 0 ? current : new Set()));
  }, [isVisible]);

  useServerEvents({
    namespace: "automation",
    onEvent: handleServerEvent,
    onReconnect: handleServerReconnect,
  });

  const createMutation = useMutation({
    mutationFn: (input: AutomationOptions) => createServerAutomation({ data: input }),
    onSuccess: invalidateAutomations,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: AutomationOptions & { automationId: string }) => {
      const result = await updateServerAutomation({ data: input });
      if (!result.success) {
        throw new Error("Automation not found");
      }
      return result;
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
      const result = await deleteServerAutomation({ data: { automationId } });
      if (!result.success) {
        throw new Error("Automation not found");
      }
      return result;
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
    mutationFn: (automationId: string) => runServerAutomation({ data: { automationId } }),
    onMutate: (automationId) => {
      setKnownRunningAutomationIds((current) => addAutomationId(current, automationId));
    },
    onSuccess: ({ sessionId }, automationId) => {
      // Reset the detail cache to an empty session so the SessionView's
      // sync effect calls updateState([], []), clearing local mutable
      // state. This avoids briefly showing the previous run's messages
      // when the same session ID is reused.
      queryClient.setQueryData<SessionSnapshot>(sessionQueries.detail(sessionId).queryKey, {
        id: sessionId,
        messages: [],
        queuedMessages: [],
        status: "thinking",
        reasoningContent: "",
      });

      const automationTitle =
        automations.find((automation) => automation.id === automationId)?.title ?? "";
      prependSessionIfMissing(queryClient, {
        sessionId,
        startTime: new Date(),
        modifiedTime: new Date(),
        summary: automationTitle,
        isRemote: false,
      });
      onUserRunRequested?.(sessionId);
    },
    onSettled: (_data, _error, automationId) => {
      if (automationId) {
        setKnownRunningAutomationIds((current) => removeAutomationId(current, automationId));
      }
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
    runningAutomationIds,
  };
}

function addAutomationId(current: Set<string>, automationId: string): Set<string> {
  if (current.has(automationId)) return current;
  const next = new Set(current);
  next.add(automationId);
  return next;
}

function removeAutomationId(current: Set<string>, automationId: string): Set<string> {
  if (!current.has(automationId)) return current;
  const next = new Set(current);
  next.delete(automationId);
  return next;
}
