import { atom } from "jotai";
import type { WorkspacePane } from "@/lib/workspace/panes";
import { createEmptyWorkspaceState, type WorkspaceState } from "@/lib/workspace/state";

/**
 * Maps each source session ID to the panes it has published into the UI.
 * Written by individual SessionPane instances; read by pane derivation.
 */
export const linkedPanesAtom = atom<Record<string, WorkspacePane[]>>({});

/** Workspace store state. useWorkspace owns writes, transport, and hydration. */
export const workspaceStateAtom = atom<WorkspaceState>(createEmptyWorkspaceState());

/** True once useWorkspace has hydrated the store from the server. Lets readers
 *  tell "no drafts" apart from "not loaded yet" without a second query. */
export const workspaceHydratedAtom = atom(false);
