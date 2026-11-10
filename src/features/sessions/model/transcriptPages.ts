// Transcript paging. A snapshot sent to a client carries its latest page of
// messages and the offset of its first one, and previous pages load backward
// from that offset. Everything else in the snapshot, including the session's
// diff total, is reduced over the whole transcript.

import type { Message, SessionState } from ".";

/** Serialized characters per page. A larger single message still forms a page. */
const PAGE_SIZE = 1 << 20;

/** A snapshot with only its latest page of messages. */
export function latestMessages(state: SessionState): SessionState {
  const start = pageStart(state.messages, state.messages.length);
  if (start === 0) return state;
  return { ...state, messages: state.messages.slice(start), messageOffset: start };
}

/** The page ending before position `before`, plus the message at `before` as its seam. */
export function messagesBefore(messages: readonly Message[], before: number) {
  const start = pageStart(messages, Math.min(before, messages.length));
  return { messages: messages.slice(start, before + 1), messageOffset: start };
}

/** Prepend the older page's messages that precede the newer state, which stays
 *  the authority for every position it covers. They join only when both hold
 *  the same message at the newer state's first position; otherwise, such as
 *  after a rewind, the newer state stands alone. */
export function joinPreviousMessages(
  older: Pick<SessionState, "messages" | "messageOffset">,
  newer: SessionState,
): SessionState {
  const count = (newer.messageOffset ?? 0) - (older.messageOffset ?? 0);
  const seam = older.messages[count];
  if (count <= 0 || !seam || JSON.stringify(seam) !== JSON.stringify(newer.messages[0])) {
    return newer;
  }
  return {
    ...newer,
    messages: [...older.messages.slice(0, count), ...newer.messages],
    messageOffset: older.messageOffset,
  };
}

function pageStart(messages: readonly Message[], end: number): number {
  let start = end;
  let size = 0;
  while (start > 0) {
    size += JSON.stringify(messages[start - 1]).length;
    if (size > PAGE_SIZE && start < end) break;
    start--;
  }
  return start;
}
