import type { SessionMetadata } from "@/types";

type SessionTimeGroupKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

type SessionGroup = {
  key: string;
  label?: string;
  sessions: SessionMetadata[];
};

const GROUP_LABELS: Record<SessionTimeGroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  thisMonth: "This Month",
  older: "Older",
};

export function groupSessions(
  sessions: SessionMetadata[],
  pinnedSessionIds: string[],
  now?: Date,
): SessionGroup[] {
  const sortedSessions = [...sessions].sort(
    (left, right) => right.modifiedTime.getTime() - left.modifiedTime.getTime(),
  );
  const pinnedSessionIdSet = new Set(pinnedSessionIds);
  const pinnedSessions = sortedSessions.filter((session) =>
    pinnedSessionIdSet.has(session.sessionId),
  );
  const unpinnedSessions = sortedSessions.filter(
    (session) => !pinnedSessionIdSet.has(session.sessionId),
  );
  const hasPinnedGroup = pinnedSessions.length > 0;
  const groups: SessionGroup[] = hasPinnedGroup
    ? [{ key: "pinned", label: "Pinned", sessions: pinnedSessions }]
    : [];

  if (now) {
    groups.push(...groupSessionsByTime(unpinnedSessions, now, hasPinnedGroup));
  } else if (unpinnedSessions.length > 0) {
    groups.push({ key: "sessions", sessions: unpinnedSessions });
  }

  return groups;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getSessionTimeGroup(modifiedTime: Date, now: Date): SessionTimeGroupKey {
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const rollingWeekStart = new Date(todayStart);
  rollingWeekStart.setDate(rollingWeekStart.getDate() - 7);
  const monthStart = startOfMonth(now);
  const modified = modifiedTime.getTime();

  if (modified >= todayStart.getTime()) return "today";
  if (modified >= yesterdayStart.getTime()) return "yesterday";
  if (modified >= rollingWeekStart.getTime()) return "thisWeek";
  if (modified >= monthStart.getTime()) return "thisMonth";
  return "older";
}

export function groupSessionsByTime(
  sessions: SessionMetadata[],
  now: Date = new Date(),
  labelToday = false,
): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let previousTimeGroup: SessionTimeGroupKey | null = null;

  for (const session of sessions) {
    const timeGroup = getSessionTimeGroup(session.modifiedTime, now);
    const currentGroup = groups.at(-1);
    if (timeGroup === previousTimeGroup && currentGroup) {
      currentGroup.sessions.push(session);
    } else {
      groups.push({
        key: `${timeGroup}-${session.sessionId}`,
        ...(timeGroup === "today" && !labelToday ? {} : { label: GROUP_LABELS[timeGroup] }),
        sessions: [session],
      });
    }

    previousTimeGroup = timeGroup;
  }

  return groups;
}
