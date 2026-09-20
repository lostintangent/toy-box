import type { Session } from "../../model";

export type SessionFilters = {
  query: string;
  hiddenProviders: readonly string[];
  showExternalSessions: boolean;
};

/** Apply visibility before the display limit so each provider can show its own history. */
export function filterSessionList(
  sessions: readonly Session[],
  filters: SessionFilters,
): Session[] {
  const query = filters.query.trim().toLowerCase();
  return sessions
    .filter(
      (session) =>
        (filters.showExternalSessions || !session.id.includes(":")) &&
        (!session.provider || !filters.hiddenProviders.includes(session.provider.id)) &&
        (!query || session.title?.toLowerCase().includes(query)),
    )
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 50);
}
