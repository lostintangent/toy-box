import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { invalidateSessionsStateQuery } from "@sessions/queryCache";
import { applyWorkspaceEvent, invalidateWorkspaceStateQuery } from "@workspace/queries";
import type { WorkspaceEvent } from "@workspace/model/events";
import { invalidateChannelListQuery } from "@channels/queryCache";
import { providerQueries } from "@providers/queries";

/** Keeps shared Query projections aligned with the workspace update stream. */
export function useWorkspaceSync(ssrRevision?: string): void {
  const queryClient = useQueryClient();
  const isVisible = usePageVisibility();
  const initialRevision = useRef(ssrRevision);

  useEffect(() => {
    if (!isVisible) {
      initialRevision.current = undefined;
      return;
    }

    const source = new EventSource("/api/workspace");
    source.onerror = () => {
      initialRevision.current = undefined;
    };

    const refresh = () => {
      void Promise.all([
        invalidateWorkspaceStateQuery(queryClient),
        invalidateSessionsStateQuery(queryClient),
        invalidateChannelListQuery(queryClient),
        queryClient.invalidateQueries({ queryKey: providerQueries.all() }),
      ]).catch((error) => {
        console.error("Failed to refresh shared state:", error);
      });
    };

    source.onmessage = (message) => {
      if (!message.data) return;

      try {
        const event = JSON.parse(message.data) as WorkspaceEvent;
        if (event.type === "workspace.connected") {
          const unchanged = initialRevision.current === event.revision;
          // Only the initial connection may trust SSR. Reconnects also discover
          // native provider history changed outside Toy Box's broadcast plane.
          initialRevision.current = undefined;
          if (!unchanged) refresh();
          return;
        }
        applyWorkspaceEvent(queryClient, event);
      } catch (error) {
        console.error("Failed to parse workspace event:", error);
      }
    };

    return () => source.close();
  }, [isVisible, queryClient]);
}
