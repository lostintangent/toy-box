import { atom } from "jotai";

/**
 * Maps each source session ID to the linked session IDs it has published.
 * Written by individual SessionView instances; read by useLinkedSessions.
 */
export const linkedSessionsAtom = atom<Record<string, string[]>>({});
