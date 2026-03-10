// Unread session badge tracking.
//
// Tracks sessions that finished streaming while no client was watching,
// so the sidebar can show unread indicators. State changes are broadcast
// to all connected clients via the shared SSE pub/sub layer.

import { emitSessionUnread, emitSessionRead } from "../runtime/broadcast";

// Track sessions that finished streaming while no client was watching
const unreadSessionIds = new Set<string>();

/** Get IDs of all unread sessions */
export function getUnreadSessionIds(): string[] {
  return Array.from(unreadSessionIds);
}

/** Mark a session as unread */
export function markSessionUnread(sessionId: string): void {
  if (unreadSessionIds.has(sessionId)) return;
  unreadSessionIds.add(sessionId);
  emitSessionUnread(sessionId);
}

/** Mark a session as read */
export function markSessionRead(sessionId: string): void {
  if (!unreadSessionIds.delete(sessionId)) return;
  emitSessionRead(sessionId);
}

/** Remove unread state without emitting events (for session deletion) */
export function deleteUnreadState(sessionId: string): boolean {
  return unreadSessionIds.delete(sessionId);
}
