import { useEffect, useRef } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { sessionFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { workspaceSurfaces, type WorkspaceSurface } from "@workspace/hooks/layout/surface";
import type { WorkspacePane } from "@workspace/model/panes";
import { resolveEditorAutoFocus } from "./model/panes";
import { selectAutomationSessionIds, sessionQueries } from "./queries";

/** Lets a newly shown session artifact take its surface's focus, as the auto-focus setting allows. */
export function useEditorAutoFocus(surface: WorkspaceSurface, panes: WorkspacePane[]) {
  const { focusedPaneAtom } = workspaceSurfaces[surface];
  const autoFocusArtifacts = useWorkspaceSelector(
    (workspace) => workspace.settings.autoFocusArtifacts,
  );
  const { data: automationSessionIds } = useSuspenseQuery({
    ...sessionQueries.state(),
    select: selectAutomationSessionIds,
  });
  const { data: initialEditorPaneIds = [] } = useQuery({
    ...sessionQueries.state(),
    select: (state) =>
      state.sessions.flatMap((session) =>
        !session.provider && session.artifactPath
          ? [createEditorPane(sessionFile(session.id, session.artifactPath)).id]
          : [],
      ),
  });
  const seenPaneIdsRef = useRef<ReadonlySet<string> | null>(null);

  // Panes present when a surface mounts are not newly opened, except for an
  // artifact-first draft whose artifact is the surface's initial destination.
  if (seenPaneIdsRef.current === null) {
    const initialEditorPaneIdSet = new Set(initialEditorPaneIds);
    seenPaneIdsRef.current = new Set(
      panes.filter((pane) => !initialEditorPaneIdSet.has(pane.id)).map((pane) => pane.id),
    );
  }

  useEffect(() => {
    const { focusPane, seenPaneIds } = resolveEditorAutoFocus(
      seenPaneIdsRef.current!,
      panes,
      autoFocusArtifacts,
      automationSessionIds,
      new Set(initialEditorPaneIds),
    );
    seenPaneIdsRef.current = seenPaneIds;
    if (!focusPane) return;

    focusedPaneAtom.set((current) =>
      current !== null && panes.some((pane) => pane.id === current) ? current : focusPane.id,
    );
  }, [autoFocusArtifacts, automationSessionIds, focusedPaneAtom, initialEditorPaneIds, panes]);
}
