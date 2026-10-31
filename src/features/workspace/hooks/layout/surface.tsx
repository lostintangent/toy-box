import { useEffect, type ReactNode } from "react";
import { createAtom, createStoreContext, useSelector } from "@tanstack/react-store";
import { createPanePublicationsStore } from "@workspace/hooks/layout/panePublications";
import {
  deriveReachablePaneIds,
  deriveVisibleWorkspacePanes,
  MAX_HYPER_PANES,
  MAX_WORKSPACE_PANES,
  type WorkspacePane,
} from "@workspace/model/panes";

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
    /** Brings a pane forward: focuses it where the surface can reach it, and opens it otherwise. */
    reveal: (pane: WorkspacePane) => void;
    /** Whether Channel overviews stay pinned open, where the surface remembers it. */
    channelOverviewPinned?: boolean;
    setChannelOverviewPinned?: (pinned: boolean) => void;
  }
>();
export { useWorkspaceSurface };

/** Focus a pane from its host, outside the surface subtree. */
export function focusWorkspaceSurfacePane(surface: WorkspaceSurface, paneId: string): void {
  workspaceSurfaces[surface].focusedPaneAtom.set(paneId);
}

/**
 * The panes a surface shows: its roots and the panes they publish, within its capacity and
 * around its focus. Publishers its roots can no longer reach are pruned from its pane graph.
 */
export function useSurfacePanes(
  surface: WorkspaceSurface,
  rootPanes: WorkspacePane[],
): WorkspacePane[] {
  const { capacity, focusedPaneAtom, panePublications } = workspaceSurfaces[surface];
  const publications = useSelector(panePublications);
  const focusedPaneId = useSelector(focusedPaneAtom);

  const reachablePaneIds = deriveReachablePaneIds(rootPanes, publications);
  useEffect(() => {
    panePublications.actions.prunePanePublishers(new Set(reachablePaneIds));
  }, [panePublications, reachablePaneIds]);

  return deriveVisibleWorkspacePanes({
    rootPanes,
    panePublications: publications,
    maxVisible: capacity,
    focusedPaneId,
  });
}

export function WorkspaceSurfaceProvider({
  surface,
  panes,
  onOpen,
  channelOverviewPinned,
  onChannelOverviewPinnedChange,
  children,
}: {
  surface: WorkspaceSurface;
  panes: WorkspacePane[];
  /** Opens a pane this surface can't reach yet. */
  onOpen: (pane: WorkspacePane) => void;
  channelOverviewPinned?: boolean;
  onChannelOverviewPinnedChange?: (pinned: boolean) => void;
  children: ReactNode;
}) {
  const workspaceSurface = workspaceSurfaces[surface];

  function reveal(pane: WorkspacePane) {
    const isReachable =
      panes.some(({ id }) => id === pane.id) ||
      Object.values(workspaceSurface.panePublications.get()).some((linked) =>
        linked.some(({ id }) => id === pane.id),
      );
    if (isReachable) workspaceSurface.focusedPaneAtom.set(pane.id);
    else onOpen(pane);
  }

  // Keep this surface's focus on a pane it shows.
  useEffect(() => {
    workspaceSurface.focusedPaneAtom.set((current) =>
      current !== null && panes.some((pane) => pane.id === current) ? current : null,
    );
  }, [panes, workspaceSurface.focusedPaneAtom]);

  return (
    <StoreProvider
      value={{
        ...workspaceSurface,
        panes,
        reveal,
        channelOverviewPinned,
        setChannelOverviewPinned: onChannelOverviewPinnedChange,
      }}
    >
      {children}
    </StoreProvider>
  );
}
