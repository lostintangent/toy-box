import { useEffect, useRef, type ReactNode } from "react";
import { createAtom, createStoreContext, type Atom } from "@tanstack/react-store";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import {
  createEditorPaneId,
  resolveEditorAutoFocus,
  type WorkspacePane,
} from "@/lib/workspace/panes";
import { sessionFile } from "@/lib/files/workspaceFile";

export type WorkspaceSurface = "main" | "hyper";

const focusedPaneAtoms: Record<WorkspaceSurface, Atom<string | null>> = {
  main: createAtom<string | null>(null),
  hyper: createAtom<string | null>(null),
};

const { StoreProvider: FocusedPaneProvider, useStoreContext: useFocusedPaneAtom } =
  createStoreContext<Atom<string | null>>();
export { useFocusedPaneAtom };

/**
 * Focus a pane on the main surface from outside its subtree — the mobile pager
 * reads this as its active page; the desktop grid reads it as a maximize.
 */
export function focusMainSurfacePane(paneId: string): void {
  focusedPaneAtoms.main.set(paneId);
}

export function WorkspaceSurfaceProvider({
  surface,
  panes,
  children,
}: {
  surface: WorkspaceSurface;
  panes: WorkspacePane[];
  children: ReactNode;
}) {
  const focusedPaneAtom = focusedPaneAtoms[surface];
  const autoFocusArtifacts = useWorkspaceSelector(
    (workspace) => workspace.settings.autoFocusArtifacts,
  );
  const draftEditorPaneIds = useWorkspaceSelector((workspace) =>
    Object.entries(workspace.sessionStates).flatMap(([sessionId, state]) =>
      state.status === "draft" && state.artifactPath
        ? [createEditorPaneId(sessionFile(sessionId, state.artifactPath))]
        : [],
    ),
  );
  const seenPaneIdsRef = useRef<ReadonlySet<string> | null>(null);

  // Panes present when a surface mounts are not newly opened, except for an
  // artifact-first draft whose artifact is the surface's initial destination.
  if (seenPaneIdsRef.current === null) {
    const draftEditorPaneIdSet = new Set(draftEditorPaneIds);
    seenPaneIdsRef.current = new Set(
      panes.filter((pane) => !draftEditorPaneIdSet.has(pane.id)).map((pane) => pane.id),
    );
  }

  // Keep this surface's focus valid and let newly opened artifacts claim it.
  useEffect(() => {
    const draftEditorPaneIdSet = new Set(draftEditorPaneIds);
    const { focusPane, seenPaneIds } = resolveEditorAutoFocus(
      seenPaneIdsRef.current!,
      panes,
      autoFocusArtifacts,
      draftEditorPaneIdSet,
    );
    seenPaneIdsRef.current = seenPaneIds;

    focusedPaneAtom.set((current) => {
      const currentIsVisible = current !== null && panes.some((pane) => pane.id === current);
      if (currentIsVisible) return current;
      return focusPane?.id ?? null;
    });
  }, [autoFocusArtifacts, draftEditorPaneIds, focusedPaneAtom, panes]);

  return <FocusedPaneProvider value={focusedPaneAtom}>{children}</FocusedPaneProvider>;
}
