import { useCallback } from "react";
import { useAtom } from "jotai";
import { linkedPanesAtom } from "@/atoms";
import type { SessionCanvas } from "@/types";
import {
  createLinkedPanes,
  isArtifactPane,
  type ArtifactPaneMode,
  type ArtifactWorkspacePane,
  type WorkspacePane,
} from "@/lib/workspace/panes";

export type LinkedPanesBySource = Record<string, WorkspacePane[]>;

export function useLinkedPanes() {
  const [linkedPanesBySource, setLinkedPanesBySource] = useAtom(linkedPanesAtom);

  const publishSessionPanes = useCallback(
    (
      sourceSessionId: string,
      linkedSessionIds: string[],
      canvases: SessionCanvas[],
      artifacts: string[],
    ) => {
      setLinkedPanesBySource((current) => {
        const nextSourcePanes = createLinkedPanes(
          sourceSessionId,
          linkedSessionIds,
          canvases,
          artifacts,
          current[sourceSessionId],
        );

        if (haveSamePaneState(current[sourceSessionId] ?? [], nextSourcePanes)) return current;

        return {
          ...current,
          [sourceSessionId]: nextSourcePanes,
        };
      });
    },
    [setLinkedPanesBySource],
  );

  const clearSessionPanes = useCallback(
    (sourceSessionId: string) => {
      setLinkedPanesBySource((current) => removePaneSource(current, sourceSessionId));
    },
    [setLinkedPanesBySource],
  );

  const prunePaneSources = useCallback(
    (sourceSessionIds: ReadonlySet<string>) => {
      setLinkedPanesBySource((current) => {
        const nextEntries = Object.entries(current).filter(([sourceSessionId]) =>
          sourceSessionIds.has(sourceSessionId),
        );
        if (nextEntries.length === Object.keys(current).length) return current;

        return Object.fromEntries(nextEntries);
      });
    },
    [setLinkedPanesBySource],
  );

  const setArtifactPaneMode = useCallback(
    (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => {
      setLinkedPanesBySource((current) => setArtifactPaneModeState(current, pane, mode));
    },
    [setLinkedPanesBySource],
  );

  return {
    linkedPanesBySource,
    publishSessionPanes,
    clearSessionPanes,
    prunePaneSources,
    setArtifactPaneMode,
  };
}

function setArtifactPaneModeState(
  current: LinkedPanesBySource,
  pane: ArtifactWorkspacePane,
  mode: ArtifactPaneMode,
): LinkedPanesBySource {
  const sourcePanes = current[pane.sourceSessionId] ?? [];
  let didUpdate = false;
  const nextSourcePanes = sourcePanes.map((sourcePane) => {
    if (!isArtifactPane(sourcePane) || sourcePane.id !== pane.id) return sourcePane;
    if (sourcePane.mode === mode) return sourcePane;

    didUpdate = true;
    return {
      ...sourcePane,
      mode,
    };
  });

  if (!didUpdate) return current;

  return {
    ...current,
    [pane.sourceSessionId]: nextSourcePanes,
  };
}

function removePaneSource(
  current: LinkedPanesBySource,
  sourceSessionId: string,
): LinkedPanesBySource {
  if (!(sourceSessionId in current)) return current;
  const { [sourceSessionId]: _removed, ...rest } = current;
  return rest;
}

function haveSamePaneState(left: WorkspacePane[], right: WorkspacePane[]): boolean {
  return (
    left.length === right.length &&
    left.every((pane, index) => {
      const nextPane = right[index];
      if (pane.id !== nextPane?.id) return false;

      if (isArtifactPane(pane) && isArtifactPane(nextPane)) {
        return pane.mode === nextPane.mode;
      }

      return true;
    })
  );
}
