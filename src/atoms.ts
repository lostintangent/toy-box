import { atom } from "jotai";
import type { SessionGridPane } from "@/hooks/session/sessionPanes";

/**
 * Maps each source session ID to the panes it has linked into the UI.
 * Written by individual SessionView instances; read by pane derivation.
 */
export const linkedPanesAtom = atom<Record<string, SessionGridPane[]>>({});
