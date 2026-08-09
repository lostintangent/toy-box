import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { invalidateSessionsStateQuery } from "@sessions/queryCache";
import { applyWorkspaceEvent, invalidateWorkspaceStateQuery } from "@workspace/queries";
import type { WorkspaceEvent } from "@workspace/model/events";

/** Keeps shared Query projections aligned with the workspace update stream. */
export function useWorkspaceSync(): void {
  const queryClient = useQueryClient();
  const isVisible = usePageVisibility();

  useEffect(() => {
    if (!isVisible) return;

    const source = new EventSource("/api/workspace");
    source.onopen = () => {
      void Promise.all([
        invalidateWorkspaceStateQuery(queryClient),
        invalidateSessionsStateQuery(queryClient),
      ]).catch((error) => {
        console.error("Failed to refresh shared state:", error);
      });
    };
    source.onmessage = (message) => {
      if (!message.data) return;

      try {
        applyWorkspaceEvent(queryClient, JSON.parse(message.data) as WorkspaceEvent);
      } catch (error) {
        console.error("Failed to parse workspace event:", error);
      }
    };
    return () => source.close();
  }, [isVisible, queryClient]);
}
