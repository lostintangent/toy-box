import type { Session } from "../../model";

export type SessionFilters = {
  query: string;
  hiddenProviders: readonly string[];
  showExternalSessions: boolean;
};

/** Keep pins visible; apply filters before limiting ordinary results to fifty. */
export function filterSessionList(
  sessions: readonly Session[],
  filters: SessionFilters,
  pinnedSessionIds: readonly string[] = [],
): Session[] {
  const query = filters.query.trim().toLowerCase();
  const pinned = new Set(pinnedSessionIds);
  let recentCount = 0;
  return sessions
    .filter(
      (session) =>
        pinned.has(session.id) ||
        ((filters.showExternalSessions || !session.id.includes(":")) &&
          (!session.provider || !filters.hiddenProviders.includes(session.provider.id)) &&
          (!query || session.title?.toLowerCase().includes(query))),
    )
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .filter(({ id }) => pinned.has(id) || recentCount++ < 50);
}
