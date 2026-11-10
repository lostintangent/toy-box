import { createStoreContext } from "@tanstack/react-store";
import type { WorkspacePane } from "@workspace/model/panes";

/**
 * The main workspace's roots, which its route owns in the URL, as the shell's chrome (the sidebar,
 * palette and dialogs) changes and reads them. Panes reach their surface through `reveal` instead:
 * Hyper's surface has no roots, and only the chrome renders for a navigation still committing.
 */
export type WorkspaceRoots = {
  /** Shows a pane in place of the roots, or with a modifier toggles it beside them. */
  selectRoot: (pane: WorkspacePane, toggleInWorkspace?: boolean) => void;
  /** Opens a pane beside the roots, or in their place when the workspace is full. */
  openRoot: (pane: WorkspacePane) => Promise<void>;
  /** Whether a pane is open, or about to be (see `deriveOpenPaneIds`). */
  isOpen: (pane: WorkspacePane) => boolean;
};

export const { StoreProvider: WorkspaceRootsProvider, useStoreContext: useWorkspaceRoots } =
  createStoreContext<WorkspaceRoots>();
