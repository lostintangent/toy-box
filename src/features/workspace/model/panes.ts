export const MAX_WORKSPACE_PANES = 4;
export const MAX_HYPER_PANES = 6;

/** The pane kinds features declare, keyed by kind, with the parameters each kind's panes carry.
 *  A feature augments this from its model, and its `panes.tsx` declares how they're shown. */
export interface WorkspacePanes {}

/** Browser-local content identity shared by grid, pager, and Hyper hosts, of any kind or of one.
 *  `id` is a pane's mounted identity, and `sessionId` names the session it belongs to, if any. */
export type WorkspacePane<Kind extends keyof WorkspacePanes = keyof WorkspacePanes> = {
  [K in Kind]: { kind: K; id: string; sessionId?: string } & WorkspacePanes[K];
}[Kind];

/** A pane's id is its kind and the key of its content, so the same content is always one pane. */
export function createPane<Kind extends keyof WorkspacePanes>(
  kind: Kind,
  key: string,
  params: WorkspacePanes[Kind] & { sessionId?: string },
): WorkspacePane<Kind> {
  return { kind, id: `${kind}:${key}`, ...params } as WorkspacePane<Kind>;
}

/** The browser-local pane graph, keyed by the pane that published each edge. */
export type PanePublications = Readonly<Record<string, readonly WorkspacePane[]>>;

type DeriveVisibleWorkspacePanesOptions = {
  rootPanes: WorkspacePane[];
  panePublications: PanePublications;
  maxVisible?: number;
  focusedPaneId?: string | null;
};

export function deriveVisibleWorkspacePanes({
  rootPanes,
  panePublications,
  maxVisible = MAX_WORKSPACE_PANES,
  focusedPaneId,
}: DeriveVisibleWorkspacePanesOptions): WorkspacePane[] {
  const visiblePanes = rootPanes.slice(0, maxVisible);
  const seenPaneIds = new Set(visiblePanes.map((pane) => pane.id));
  const publishers = [...visiblePanes];

  while (publishers.length > 0 && visiblePanes.length < maxVisible) {
    const publisher = publishers.shift();
    if (!publisher) break;

    // Each publisher orders its own linked panes.
    for (const pane of panePublications[publisher.id] ?? []) {
      if (seenPaneIds.has(pane.id)) continue;
      seenPaneIds.add(pane.id);
      visiblePanes.push(pane);
      publishers.push(pane);
      if (visiblePanes.length === maxVisible) break;
    }
  }

  // An explicit focus request can select a published pane beyond the grid
  // capacity. Replace an unrelated pane, retaining the publishers that keep
  // the requested surface alive. Clearing focus restores the ordinary order.
  if (focusedPaneId && !seenPaneIds.has(focusedPaneId)) {
    const focusedPane = deriveReachablePanes(rootPanes, panePublications).find(
      (pane) => pane.id === focusedPaneId,
    );
    if (focusedPane) {
      for (let index = visiblePanes.length - 1; index >= 0; index--) {
        const pane = visiblePanes[index]!;
        if (deriveReachablePaneIds([pane], panePublications).includes(focusedPaneId)) continue;
        visiblePanes[index] = focusedPane;
        break;
      }
    }
  }

  return visiblePanes;
}

export function deriveReachablePaneIds(
  rootPanes: WorkspacePane[],
  panePublications: PanePublications,
): string[] {
  return deriveReachablePanes(rootPanes, panePublications).map((pane) => pane.id);
}

function deriveReachablePanes(
  rootPanes: WorkspacePane[],
  panePublications: PanePublications,
): WorkspacePane[] {
  const reachablePanes: WorkspacePane[] = [];
  const seenPaneIds = new Set<string>();
  const queue = [...rootPanes];

  while (queue.length > 0) {
    const pane = queue.shift();
    if (!pane || seenPaneIds.has(pane.id)) continue;

    seenPaneIds.add(pane.id);
    reachablePanes.push(pane);

    for (const linkedPane of panePublications[pane.id] ?? []) {
      if (!seenPaneIds.has(linkedPane.id)) queue.push(linkedPane);
    }
  }

  return reachablePanes;
}
