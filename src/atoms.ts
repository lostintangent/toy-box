import { atom } from "jotai";
import type { SessionGridPane } from "@/hooks/session/sessionPanes";

/**
 * Maps each source session ID to the panes it has published into the UI.
 * Written by individual SessionPane instances; read by pane derivation.
 */
export const linkedPanesAtom = atom<Record<string, SessionGridPane[]>>({});

/**
 * The visible pane that currently has the stage, or null when none does.
 * Each layout renders it with its own mechanism (the desktop grid maximizes
 * it, the mobile pager pages to it), and both write it on user interaction.
 * Null means "no focus", so artifact auto-focus may claim it; see usePaneFocus
 * for the write policy.
 */
export const focusedPaneAtom = atom<string | null>(null);
