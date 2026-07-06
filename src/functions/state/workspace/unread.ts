// Unread session badge tracking.
//
// Tracks sessions that finished streaming while no client was watching,
// so the sidebar can show unread indicators. Public transitions and broadcasts
// are composed by ./index.ts.

import { sharedSet } from "../../runtime/processState";

// Track sessions that finished streaming while no client was watching
const unreadSessionIds = sharedSet<string>("unread-session-ids");

/** Get IDs of all unread sessions */
export function getUnreadSessionIds(): string[] {
  return Array.from(unreadSessionIds);
}

/** Mark a session as unread */
export function addUnreadSession(sessionId: string): boolean {
  if (unreadSessionIds.has(sessionId)) return false;
  unreadSessionIds.add(sessionId);
  return true;
}

/** Remove unread state without emitting events (for session deletion) */
export function deleteUnreadState(sessionId: string): boolean {
  return unreadSessionIds.delete(sessionId);
}
