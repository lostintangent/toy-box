import type { SessionMetadata } from "../../model";
import { SESSION_ID_PREFIX } from "../../model/constants";

/** Apply visibility before the display limit so each provider can show its own history. */
export function filterSessionList(
  sessions: readonly SessionMetadata[],
  filters: { showExternalSessions: boolean; hiddenProviders: readonly string[]; query: string },
): SessionMetadata[] {
  const query = filters.query.trim().toLowerCase();
  return sessions
    .filter(
      (session) =>
        (filters.showExternalSessions || session.sessionId.startsWith(SESSION_ID_PREFIX)) &&
        (!session.provider || !filters.hiddenProviders.includes(session.provider)) &&
        (!query || session.title?.toLowerCase().includes(query)),
    )
    .sort((left, right) => right.modifiedTime.getTime() - left.modifiedTime.getTime())
    .slice(0, 50);
}
