import { createStore } from "@tanstack/react-store";
import type { SessionCanvas } from "@/types";
import {
  createSessionPaneId,
  createLinkedPanes,
  isArtifactPane,
  type ArtifactPaneMode,
  type ArtifactWorkspacePane,
  type LinkedPanesByPublisher,
  type WorkspacePane,
} from "@/lib/workspace/panes";

// This module singleton is one browser's local pane graph. React consumers
// select from it directly; application writes use the domain commands below.
export const linkedPanesStore = createLinkedPanesStore();
export const {
  publishSessionPanes,
  publishLinkedPanes,
  clearLinkedPanes,
  prunePanePublishers,
  setArtifactPaneMode,
} = linkedPanesStore.actions;

export function createLinkedPanesStore() {
  const initialState: LinkedPanesByPublisher = {};

  return createStore(initialState, ({ setState }) => ({
    publishSessionPanes(
      sourceSessionId: string,
      linkedSessionIds: readonly string[],
      canvases: readonly SessionCanvas[],
      artifacts: readonly string[],
    ) {
      setState((current) => {
        const publisherPaneId = createSessionPaneId(sourceSessionId);
        const nextPanes = createLinkedPanes(
          sourceSessionId,
          linkedSessionIds,
          canvases,
          artifacts,
          current[publisherPaneId],
        );

        return replacePublishedPanes(current, publisherPaneId, nextPanes);
      });
    },

    publishLinkedPanes(publisherPaneId: string, panes: readonly WorkspacePane[]) {
      setState((current) => replacePublishedPanes(current, publisherPaneId, panes));
    },

    clearLinkedPanes(publisherPaneId: string) {
      setState((current) => removePanePublisher(current, publisherPaneId));
    },

    prunePanePublishers(reachablePaneIds: ReadonlySet<string>) {
      setState((current) => {
        const currentEntries = Object.entries(current);
        const nextEntries = currentEntries.filter(([publisherPaneId]) =>
          reachablePaneIds.has(publisherPaneId),
        );
        if (nextEntries.length === currentEntries.length) return current;

        return Object.fromEntries(nextEntries);
      });
    },

    setArtifactPaneMode(pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) {
      setState((current) => updateArtifactPaneMode(current, pane, mode));
    },
  }));
}

export function updateArtifactPaneMode(
  current: LinkedPanesByPublisher,
  pane: ArtifactWorkspacePane,
  mode: ArtifactPaneMode,
): LinkedPanesByPublisher {
  let next: Record<string, readonly WorkspacePane[]> | undefined;

  for (const [publisherPaneId, publishedPanes] of Object.entries(current)) {
    const paneIndex = publishedPanes.findIndex((publishedPane) => publishedPane.id === pane.id);
    const publishedPane = publishedPanes[paneIndex];
    if (!publishedPane || !isArtifactPane(publishedPane) || publishedPane.mode === mode) continue;

    const nextPublishedPanes = [...publishedPanes];
    nextPublishedPanes[paneIndex] = { ...publishedPane, mode };
    next ??= { ...current };
    next[publisherPaneId] = nextPublishedPanes;
  }

  return next ?? current;
}

function replacePublishedPanes(
  current: LinkedPanesByPublisher,
  publisherPaneId: string,
  panes: readonly WorkspacePane[],
): LinkedPanesByPublisher {
  if (panes.length === 0) return removePanePublisher(current, publisherPaneId);
  if (arePaneListsEqual(current[publisherPaneId] ?? [], panes)) return current;

  return { ...current, [publisherPaneId]: panes };
}

function removePanePublisher(
  current: LinkedPanesByPublisher,
  publisherPaneId: string,
): LinkedPanesByPublisher {
  if (!(publisherPaneId in current)) return current;

  const next: Record<string, readonly WorkspacePane[]> = { ...current };
  delete next[publisherPaneId];
  return next;
}

export function arePaneListsEqual(
  left: readonly WorkspacePane[],
  right: readonly WorkspacePane[],
): boolean {
  return (
    left.length === right.length &&
    left.every((pane, index) => {
      const nextPane = right[index];
      if (pane.id !== nextPane?.id || pane.kind !== nextPane.kind) return false;

      if (isArtifactPane(pane) && isArtifactPane(nextPane)) {
        return pane.mode === nextPane.mode && pane.title === nextPane.title;
      }

      if (pane.kind === "session" && nextPane.kind === "session") {
        return pane.isLinkedOnly === nextPane.isLinkedOnly;
      }

      return true;
    })
  );
}
