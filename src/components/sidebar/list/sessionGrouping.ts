import type { SessionMetadata } from "@/types";

type SessionTimeGroup = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";
type LabeledSessionTimeGroup = Exclude<SessionTimeGroup, "today">;

type SessionGroup = {
  key: string;
  label?: string;
  sessions: SessionMetadata[];
};

const GROUP_LABELS: Record<LabeledSessionTimeGroup, string> = {
  yesterday: "Yesterday",
  thisWeek: "This Week",
  thisMonth: "This Month",
  older: "Older",
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getSessionTimeGroup(modifiedTime: Date, now: Date): SessionTimeGroup {
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
): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let previousTimeGroup: SessionTimeGroup | null = null;

  for (const session of sessions) {
    const timeGroup = getSessionTimeGroup(session.modifiedTime, now);
    const currentGroup = groups.at(-1);
    if (timeGroup === previousTimeGroup && currentGroup) {
      currentGroup.sessions.push(session);
    } else {
      groups.push({
        key: `${timeGroup}-${session.sessionId}`,
        ...(timeGroup === "today" ? {} : { label: GROUP_LABELS[timeGroup] }),
        sessions: [session],
      });
    }

    previousTimeGroup = timeGroup;
  }

  return groups;
}
