import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useSetting } from "@/hooks/browser/useSetting";
import { resolveArtifactAutoFocus, type WorkspacePane } from "@/lib/workspace/panes";
import { focusedPaneAtomFor, type WorkspaceKind } from "./atoms";

/**
 * Applies the central write policies for a workspace kind's focus atom against
 * its visible pane list. Call it once per surface where the panes are derived
 * (the sessions route for "normal", the hyper deck for "hyper"). Surfaces read
 * and write the atom via useWorkspaceContext, each rendering focus with its own
 * mechanism (the grid maximizes the focused pane, the pager pages to it).
 *
 * - Auto-focus: when a setting-eligible artifact pane appears, it claims the
 *   focus if nothing valid holds it — null, or a focus whose pane departed. A
 *   focus the user placed is never stolen (see resolveArtifactAutoFocus for the
 *   appearance and layout rules). Panes visible on first render are seeded as
 *   already seen, so a remount (e.g. a viewport switch) never re-triggers.
 * - Validity: focus only means something for a visible pane, so it clears when
 *   the focused pane leaves the list. Re-focusing a reopened source is
 *   auto-focus re-arming by design, never stale state re-attaching.
 *
 * Writes go through useSetAtom, so the caller never re-renders on focus
 * changes — only the surfaces that subscribe do.
 */
export function useWorkspaceFocus(panes: WorkspacePane[], kind: WorkspaceKind = "normal") {
  const setFocusedPaneId = useSetAtom(focusedPaneAtomFor(kind));
  const autoFocusArtifacts = useSetting("autoFocusArtifacts");
  const seenPaneIdsRef = useRef<ReadonlySet<string> | null>(null);

  // Seed on first render — these panes are not "new"
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

    // One atomic pass over both write policies: a valid focus is never stolen,
    // an unheld focus is claimed by a newly appeared eligible artifact, and a
    // focus whose pane departed clears.
    setFocusedPaneId((current) => {
      const currentIsVisible = current !== null && panes.some((pane) => pane.id === current);
      if (currentIsVisible) return current;
      return focusPane ? focusPane.id : null;
    });
  }, [autoFocusArtifacts, panes, setFocusedPaneId]);
}
