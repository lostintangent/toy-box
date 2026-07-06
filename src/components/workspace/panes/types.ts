/**
 * The base props every pane *view* component accepts from the host that renders
 * it — the generalized contract behind SessionPane, ArtifactPane, and CanvasPane.
 *
 * This is distinct from the `WorkspacePane` data type (lib/workspace/panes): that
 * describes what a pane *is* (and is the shape stored in `linkedPanesAtom`); this
 * describes how a host renders one. A pane doesn't *have* a variant — the host
 * picks one per render — so these are component props, not pane state. Canvas has
 * no title-bar actions, so it accepts these and ignores them.
 *
 * `variant` shapes the pane's own controls (the names nod to vim's modes):
 * - "normal" (default): the desktop grid. The session keeps its location picker
 *   inline in the composer; an artifact styles its declared actions as icon-only
 *   overlay buttons.
 * - "compact": the pager (mobile + the hyper deck). The session moves its location
 *   picker and message badges out of the body and declares them; an artifact
 *   declares a labeled mode badge.
 *
 * `actionsSlot` is the element a pane portals its declared actions into. Both
 * hosts provide one — the grid points it at the cell's hover-overlay controls, the
 * pager at its title bar (handed only to the active pane, so exactly one pane's
 * actions show at a time). With no slot, a pane renders inline only.
 */
export type PaneVariant = "normal" | "compact";

export type PaneProps = {
  variant?: PaneVariant;
  actionsSlot?: HTMLElement | null;
};
