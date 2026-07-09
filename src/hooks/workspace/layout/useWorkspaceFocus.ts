import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { autoFocusArtifactsAtom } from "@/lib/config/settings";
import { resolveArtifactAutoFocus, type WorkspacePane } from "@/lib/workspace/panes";
import { focusedPaneAtomFor, type WorkspaceSurface } from "./focus";

/** Keeps focus valid and lets newly opened artifacts claim an unheld surface. */
export function useWorkspaceFocus(panes: WorkspacePane[], surface: WorkspaceSurface = "main") {
  const setFocusedPaneId = useSetAtom(focusedPaneAtomFor(surface));
  const autoFocusArtifacts = useAtomValue(autoFocusArtifactsAtom);
  const seenPaneIdsRef = useRef<ReadonlySet<string> | null>(null);

  // Panes present when a surface mounts are not newly opened.
  if (seenPaneIdsRef.current === null) {
    seenPaneIdsRef.current = new Set(panes.map((pane) => pane.id));
  }

  useEffect(() => {
    const { focusPane, seenPaneIds } = resolveArtifactAutoFocus(
      seenPaneIdsRef.current!,
      panes,
      autoFocusArtifacts,
    );
    seenPaneIdsRef.current = seenPaneIds;

    setFocusedPaneId((current) => {
      const currentIsVisible = current !== null && panes.some((pane) => pane.id === current);
      if (currentIsVisible) return current;
      return focusPane?.id ?? null;
    });
  }, [autoFocusArtifacts, panes, setFocusedPaneId]);
}
