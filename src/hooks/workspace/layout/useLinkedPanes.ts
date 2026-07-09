import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";
import type { SessionCanvas } from "@/types";
import {
  createSessionPaneId,
  createLinkedPanes,
  isArtifactPane,
  type ArtifactPaneMode,
  type ArtifactWorkspacePane,
  type WorkspacePane,
} from "@/lib/workspace/panes";

export type LinkedPanesByPublisher = Record<string, WorkspacePane[]>;

// Linked panes are browser-local workspace layout, not server workspace state.
const linkedPanesAtom = atom<LinkedPanesByPublisher>({});
const publishedPanesAtom = atomFamily((publisherPaneId: string) =>
  selectAtom(linkedPanesAtom, (linkedPanes) => linkedPanes[publisherPaneId] ?? [], haveSamePanes),
);

export function useLinkedPanes() {
  const linkedPanesByPublisher = useAtomValue(linkedPanesAtom);
  const actions = useLinkedPaneActions();
  return { linkedPanesByPublisher, ...actions };
}

export function usePublishedPanes(publisherPaneId: string) {
  return useAtomValue(publishedPanesAtom(publisherPaneId));
}

/** Publishers write without subscribing their host pane to the full layout graph. */
export function useLinkedPaneActions() {
  const setLinkedPanesByPublisher = useSetAtom(linkedPanesAtom);

  function publishSessionPanes(
    sourceSessionId: string,
    linkedSessionIds: string[],
    canvases: SessionCanvas[],
    artifacts: string[],
  ) {
    setLinkedPanesByPublisher((current) => {
      const publisherPaneId = createSessionPaneId(sourceSessionId);
      const nextPanes = createLinkedPanes(
        sourceSessionId,
        linkedSessionIds,
        canvases,
        artifacts,
        current[publisherPaneId],
      );

      if (haveSamePanes(current[publisherPaneId] ?? [], nextPanes)) return current;

      return {
        ...current,
        [publisherPaneId]: nextPanes,
      };
    });
  }

  function publishLinkedPanes(publisherPaneId: string, panes: WorkspacePane[]) {
    setLinkedPanesByPublisher((current) => {
      if (haveSamePanes(current[publisherPaneId] ?? [], panes)) return current;
      if (panes.length > 0) return { ...current, [publisherPaneId]: panes };
      if (!(publisherPaneId in current)) return current;

      const next = { ...current };
      delete next[publisherPaneId];
      return next;
    });
  }

  function prunePanePublishers(reachablePaneIds: ReadonlySet<string>) {
    setLinkedPanesByPublisher((current) => {
      const currentEntries = Object.entries(current);
      const nextEntries = currentEntries.filter(([publisherPaneId]) =>
        reachablePaneIds.has(publisherPaneId),
      );
      if (nextEntries.length === currentEntries.length) return current;

      return Object.fromEntries(nextEntries);
    });
  }

  function setArtifactPaneMode(pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) {
    setLinkedPanesByPublisher((current) => updateArtifactPaneMode(current, pane, mode));
  }

  return {
    publishSessionPanes,
    publishLinkedPanes,
    prunePanePublishers,
    setArtifactPaneMode,
  };
}

export function updateArtifactPaneMode(
  current: LinkedPanesByPublisher,
  pane: ArtifactWorkspacePane,
  mode: ArtifactPaneMode,
): LinkedPanesByPublisher {
  let next = current;

  for (const [publisherPaneId, publishedPanes] of Object.entries(current)) {
    const paneIndex = publishedPanes.findIndex((publishedPane) => publishedPane.id === pane.id);
    const publishedPane = publishedPanes[paneIndex];
    if (!publishedPane || !isArtifactPane(publishedPane) || publishedPane.mode === mode) continue;

    const nextPublishedPanes = [...publishedPanes];
    nextPublishedPanes[paneIndex] = { ...publishedPane, mode };
    if (next === current) next = { ...current };
    next[publisherPaneId] = nextPublishedPanes;
  }

  return next;
}

function haveSamePanes(left: WorkspacePane[], right: WorkspacePane[]): boolean {
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
