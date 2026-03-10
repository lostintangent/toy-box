import type { SessionMetadata } from "@/types";

export type SessionTimeBucket = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";
type NonTodayBucket = Exclude<SessionTimeBucket, "today">;

export type SessionListEntry =
  | {
      type: "heading";
      key: string;
      label: string;
      bucket: NonTodayBucket;
      count: number;
    }
  | {
      type: "session";
      key: string;
      session: SessionMetadata;
    };

const BUCKET_LABELS: Record<NonTodayBucket, string> = {
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

export function getSessionTimeBucket(modifiedTime: Date, now: Date): SessionTimeBucket {
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

export function buildSessionListEntries(
  sessions: SessionMetadata[],
  now: Date = new Date(),
): SessionListEntry[] {
  const entries: SessionListEntry[] = [];
  let previousBucket: SessionTimeBucket | null = null;
  let currentHeading: Extract<SessionListEntry, { type: "heading" }> | null = null;

  for (const session of sessions) {
    const bucket = getSessionTimeBucket(session.modifiedTime, now);

    if (bucket !== "today" && bucket !== previousBucket) {
      currentHeading = {
        type: "heading",
        key: `heading-${bucket}-${session.sessionId}`,
        label: BUCKET_LABELS[bucket],
        bucket,
        count: 0,
      };
      entries.push(currentHeading);
    } else if (bucket === "today") {
      currentHeading = null;
    }

    if (bucket !== "today" && currentHeading) {
      currentHeading.count += 1;
    }

    entries.push({
      type: "session",
      key: session.sessionId,
      session,
    });

    previousBucket = bucket;
  }

  return entries;
}
