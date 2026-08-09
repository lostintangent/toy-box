import { useEffect, useRef, type ReactNode } from "react";
import { createAtom, createStoreContext } from "@tanstack/react-store";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { createPanePublicationsStore } from "@workspace/hooks/layout/panePublications";
import {
  createEditorPaneId,
  MAX_HYPER_PANES,
  MAX_WORKSPACE_PANES,
  resolveEditorAutoFocus,
  type WorkspacePane,
} from "@workspace/model/panes";
import { sessionFile } from "@files/model";

// Store identities follow the browser workspace, not a host mount; Hyper may
// unmount while minimized.
function createWorkspaceSurface(capacity: number) {
  return {
    capacity,
    focusedPaneAtom: createAtom<string | null>(null),
    panePublications: createPanePublicationsStore(),
  };
}

export const workspaceSurfaces = {
  main: createWorkspaceSurface(MAX_WORKSPACE_PANES),
  hyper: createWorkspaceSurface(MAX_HYPER_PANES),
};

export type WorkspaceSurface = keyof typeof workspaceSurfaces;

const { StoreProvider, useStoreContext: useWorkspaceSurface } = createStoreContext<
  (typeof workspaceSurfaces)[WorkspaceSurface] & {
    panes: readonly WorkspacePane[];
    openApp: (appId: string) => void;
  }
>();
export { useWorkspaceSurface };

/** Focus a pane from its host, outside the surface subtree. */
export function focusWorkspaceSurfacePane(surface: WorkspaceSurface, paneId: string): void {
  workspaceSurfaces[surface].focusedPaneAtom.set(paneId);
}

export function useFocusedPaneAtom() {
  return useWorkspaceSurface().focusedPaneAtom;
}

export function WorkspaceSurfaceProvider({
  surface,
  panes,
  onOpenApp,
  children,
}: {
  surface: WorkspaceSurface;
  panes: WorkspacePane[];
  onOpenApp: (appId: string) => void;
  children: ReactNode;
}) {
  const workspaceSurface = workspaceSurfaces[surface];
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

    workspaceSurface.focusedPaneAtom.set((current) => {
      const currentIsVisible = current !== null && panes.some((pane) => pane.id === current);
      if (currentIsVisible) return current;
      return focusPane?.id ?? null;
    });
  }, [autoFocusArtifacts, draftEditorPaneIds, panes, workspaceSurface.focusedPaneAtom]);

  return (
    <StoreProvider value={{ ...workspaceSurface, panes, openApp: onOpenApp }}>
      {children}
    </StoreProvider>
  );
}
