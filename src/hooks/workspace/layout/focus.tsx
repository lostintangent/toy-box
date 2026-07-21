import { useEffect, useRef, type ReactNode } from "react";
import { createAtom, createStoreContext, type Atom } from "@tanstack/react-store";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { resolveArtifactAutoFocus, type WorkspacePane } from "@/lib/workspace/panes";

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
  const seenPaneIdsRef = useRef<ReadonlySet<string> | null>(null);

  // Panes present when a surface mounts are not newly opened.
  if (seenPaneIdsRef.current === null) {
    seenPaneIdsRef.current = new Set(panes.map((pane) => pane.id));
  }

  // Keep this surface's focus valid and let newly opened artifacts claim it.
  useEffect(() => {
    const { focusPane, seenPaneIds } = resolveArtifactAutoFocus(
      seenPaneIdsRef.current!,
      panes,
      autoFocusArtifacts,
    );
    seenPaneIdsRef.current = seenPaneIds;

    focusedPaneAtom.set((current) => {
      const currentIsVisible = current !== null && panes.some((pane) => pane.id === current);
      if (currentIsVisible) return current;
      return focusPane?.id ?? null;
    });
  }, [autoFocusArtifacts, focusedPaneAtom, panes]);

  return <FocusedPaneProvider value={focusedPaneAtom}>{children}</FocusedPaneProvider>;
}
