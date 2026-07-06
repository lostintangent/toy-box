import { atom, type PrimitiveAtom } from "jotai";

// Workspace-internal shared atoms. Don't import these directly outside the
// workspace hooks — read focus via useWorkspaceContext().focusedPaneAtom.

/**
 * A kind of workspace surface, each owning an independent pane focus. "normal" is
 * the main inline grid (or the mobile pager); "hyper" is the floating hyper deck.
 * There is always a normal workspace and at most one hyper one.
 */
export type WorkspaceKind = "normal" | "hyper";

/**
 * The visible pane that currently has the stage within a workspace kind, or null
 * when none does. Each surface renders it with its own mechanism (the grid
 * maximizes it, the pager pages to it) and writes it on user interaction. Null
 * means "no focus", so artifact auto-focus may claim it; see useWorkspaceFocus.
 *
 * A closed two-kind set, so a static record fits better than a dynamic
 * atomFamily — there are no unbounded keys to create or evict.
 */
const focusedPaneAtoms: Record<WorkspaceKind, PrimitiveAtom<string | null>> = {
  normal: atom<string | null>(null),
  hyper: atom<string | null>(null),
};

export function focusedPaneAtomFor(kind: WorkspaceKind): PrimitiveAtom<string | null> {
  return focusedPaneAtoms[kind];
}
