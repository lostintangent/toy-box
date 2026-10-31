import { replaceEqualDeep } from "@tanstack/react-query";
import { createStore } from "@tanstack/react-store";
import type { PanePublications, WorkspacePane } from "@workspace/model/panes";

type LinkedPanes = readonly WorkspacePane[];

export function createPanePublicationsStore() {
  const initialState: PanePublications = {};

  return createStore(initialState, ({ setState }) => ({
    /** Replace the panes one publisher links, or derive them from what it links now. */
    publishLinkedPanes(
      publisherPaneId: string,
      panes: LinkedPanes | ((current: LinkedPanes) => LinkedPanes),
    ) {
      setState((current) => {
        const next = typeof panes === "function" ? panes(current[publisherPaneId] ?? []) : panes;
        if (next.length === 0) return removePanePublisher(current, publisherPaneId);
        return replaceEqualDeep(current, { ...current, [publisherPaneId]: next });
      });
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
  }));
}

function removePanePublisher(current: PanePublications, publisherPaneId: string): PanePublications {
  if (!(publisherPaneId in current)) return current;

  const next: Record<string, LinkedPanes> = { ...current };
  delete next[publisherPaneId];
  return next;
}
