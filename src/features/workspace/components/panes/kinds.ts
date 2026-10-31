import type { ComponentType } from "react";
import type { z } from "zod";
import {
  MAX_WORKSPACE_PANES,
  type WorkspacePane,
  type WorkspacePanes,
} from "@workspace/model/panes";
import type { PaneVariant } from "@/shared/panes/PaneSlots";

/** How the workspace shows one kind of pane. */
type PaneKind<Kind extends keyof WorkspacePanes, Pane = WorkspacePane<Kind>> = {
  View: ComponentType<{
    pane: Pane;
    variant: PaneVariant;
    isVisible: boolean;
    onFocusPane?: (paneId: string) => void;
  }>;
  /** The pager dot's label and color. */
  label: (pane: Pane) => string;
  color: string;
  /** How a pane the user opens lives in the workspace URL: as one `schema` item under `key`. */
  root?: {
    key: string;
    schema: z.ZodType;
    pane: (item: never) => Pane;
    item: (pane: Pane) => unknown;
  };
};

/** Each feature's `panes.tsx` default-exports how the kinds it declares in `WorkspacePanes` are
 *  shown, keyed by kind. */
export type PaneKinds = {
  [Kind in keyof WorkspacePanes]?: PaneKind<Kind>;
};

export const paneKinds: Record<
  keyof WorkspacePanes,
  PaneKind<keyof WorkspacePanes>
> = Object.assign(
  {},
  ...Object.values(
    import.meta.glob<PaneKinds>("../../../*/panes.tsx", { eager: true, import: "default" }),
  ),
);

const roots = Object.values(paneKinds).flatMap(({ root }) => (root ? [root] : []));

/** The root panes a workspace URL opens, in its order, deduplicated, and capped. */
export function parseRootPanes(search: Record<string, unknown>): WorkspacePane[] {
  const panes = Object.entries(search).flatMap(([key, items]) => {
    const root = roots.find((candidate) => candidate.key === key);
    if (!root || !Array.isArray(items)) return [];
    return items.flatMap((item) => {
      const parsed = root.schema.safeParse(item);
      return parsed.success ? [root.pane(parsed.data as never)] : [];
    });
  });
  return panes
    .filter((pane, index) => panes.findIndex(({ id }) => id === pane.id) === index)
    .slice(0, MAX_WORKSPACE_PANES);
}

/** The workspace URL search that opens these root panes. */
export function serializeRootPanes(panes: readonly WorkspacePane[]): Record<string, unknown[]> {
  const search: Record<string, unknown[]> = {};
  for (const pane of panes) {
    const root = paneKinds[pane.kind].root;
    if (root) (search[root.key] ??= []).push(root.item(pane));
  }
  return search;
}
