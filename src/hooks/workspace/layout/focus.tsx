import { useEffect, useRef, type ReactNode } from "react";
import { createAtom, createStoreContext, type Atom } from "@tanstack/react-store";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import {
  createArtifactPaneId,
  resolveArtifactAutoFocus,
  type WorkspacePane,
} from "@/lib/workspace/panes";

export type WorkspaceSurface = "main" | "hyper";

const focusedPaneAtoms: Record<WorkspaceSurface, Atom<string | null>> = {
  main: createAtom<string | null>(null),
  hyper: createAtom<string | null>(null),
};

const { StoreProvider: FocusedPaneProvider, useStoreContext: useFocusedPaneAtom } =
  createStoreContext<Atom<string | null>>();
export { useFocusedPaneAtom };

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
  const draftArtifactPaneIds = useWorkspaceSelector((workspace) =>
    Object.entries(workspace.sessionStates).flatMap(([sessionId, state]) =>
      state.status === "draft" && state.artifactPath
        ? [createArtifactPaneId(sessionId, state.artifactPath)]
        : [],
    ),
  );
  const seenPaneIdsRef = useRef<ReadonlySet<string> | null>(null);

  // Panes present when a surface mounts are not newly opened, except for an
  // artifact-first draft whose artifact is the surface's initial destination.
  if (seenPaneIdsRef.current === null) {
    const draftArtifactPaneIdSet = new Set(draftArtifactPaneIds);
    seenPaneIdsRef.current = new Set(
      panes.filter((pane) => !draftArtifactPaneIdSet.has(pane.id)).map((pane) => pane.id),
    );
  }

  // Keep this surface's focus valid and let newly opened artifacts claim it.
  useEffect(() => {
    const draftArtifactPaneIdSet = new Set(draftArtifactPaneIds);
    const { focusPane, seenPaneIds } = resolveArtifactAutoFocus(
      seenPaneIdsRef.current!,
      panes,
      autoFocusArtifacts,
      draftArtifactPaneIdSet,
    );
    seenPaneIdsRef.current = seenPaneIds;

    focusedPaneAtom.set((current) => {
      const currentIsVisible = current !== null && panes.some((pane) => pane.id === current);
      if (currentIsVisible) return current;
      return focusPane?.id ?? null;
    });
  }, [autoFocusArtifacts, draftArtifactPaneIds, focusedPaneAtom, panes]);

  return <FocusedPaneProvider value={focusedPaneAtom}>{children}</FocusedPaneProvider>;
}
