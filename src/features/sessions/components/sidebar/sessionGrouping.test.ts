import { describe, expect, test } from "bun:test";
import type { SessionMetadata } from "../../model";
import { groupSessions, groupSessionsByTime } from "./sessionGrouping";

function createSession(sessionId: string, modifiedTime: Date): SessionMetadata {
  return {
    sessionId,
    startTime: modifiedTime,
    modifiedTime,
    summary: sessionId,
    isRemote: false,
  };
}

function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

function summarizeGroups(groups: ReturnType<typeof groupSessionsByTime>) {
  return groups.map((group) => ({
    label: group.label,
    sessions: group.sessions.map((session) => session.sessionId),
  }));
}

describe("session time groups", () => {
  test("returns no groups for an empty list", () => {
    expect(groupSessionsByTime([], localDate(2026, 2, 20, 14))).toEqual([]);
  });

  test("keeps today's sessions together without a heading", () => {
    const now = localDate(2026, 2, 20, 14);

    expect(
      summarizeGroups(
        groupSessionsByTime(
          [
            createSession("s1", localDate(2026, 2, 20, 13)),
            createSession("s2", localDate(2026, 2, 20, 9)),
          ],
          now,
        ),
      ),
    ).toEqual([{ label: undefined, sessions: ["s1", "s2"] }]);
  });

  test("keeps today's group identity when a newer session arrives", () => {
    const now = localDate(2026, 2, 20, 14);
    const earlier = createSession("earlier", localDate(2026, 2, 20, 9));
    const before = groupSessionsByTime([earlier], now);
    const after = groupSessionsByTime(
      [createSession("newer", localDate(2026, 2, 20, 13)), earlier],
      now,
    );

    expect(before[0]?.key).toBe("today");
    expect(after[0]?.key).toBe(before[0]?.key);
  });

  test("groups older sessions under progressively broader headings", () => {
    const now = localDate(2026, 2, 20, 14);

    expect(
      summarizeGroups(
        groupSessionsByTime(
          [
            createSession("today", localDate(2026, 2, 20, 10)),
            createSession("yesterday", localDate(2026, 2, 19, 18)),
            createSession("this-week", localDate(2026, 2, 17, 12)),
            createSession("this-month", localDate(2026, 2, 3, 12)),
            createSession("older", localDate(2026, 1, 28, 12)),
          ],
          now,
        ),
      ),
    ).toEqual([
      { label: undefined, sessions: ["today"] },
      { label: "Yesterday", sessions: ["yesterday"] },
      { label: "This Week", sessions: ["this-week"] },
      { label: "This Month", sessions: ["this-month"] },
      { label: "Older", sessions: ["older"] },
    ]);
  });

  test("creates one group per contiguous time segment", () => {
    const now = localDate(2026, 2, 20, 14);

    expect(
      summarizeGroups(
        groupSessionsByTime(
          [
            createSession("yesterday-a", localDate(2026, 2, 19, 21)),
            createSession("yesterday-b", localDate(2026, 2, 19, 9)),
            createSession("this-week-a", localDate(2026, 2, 18, 17)),
            createSession("this-week-b", localDate(2026, 2, 17, 8)),
          ],
          now,
        ),
      ),
    ).toEqual([
      { label: "Yesterday", sessions: ["yesterday-a", "yesterday-b"] },
      { label: "This Week", sessions: ["this-week-a", "this-week-b"] },
    ]);
  });

  test("uses calendar-month and rolling-seven-day boundaries", () => {
    const lateMonth = localDate(2026, 2, 20, 14);
    expect(
      summarizeGroups(
        groupSessionsByTime(
          [
            createSession("month", localDate(2026, 2, 1, 0)),
            createSession("older", localDate(2026, 1, 31, 23)),
          ],
          lateMonth,
        ),
      ).map((group) => group.label),
    ).toEqual(["This Month", "Older"]);

    const earlyMonth = localDate(2026, 2, 6, 14);
    expect(
      summarizeGroups(
        groupSessionsByTime(
          [
            createSession("week", localDate(2026, 1, 31, 12)),
            createSession("older", localDate(2026, 1, 29, 12)),
          ],
          earlyMonth,
        ),
      ).map((group) => group.label),
    ).toEqual(["This Week", "Older"]);
  });
});

describe("pinned session group", () => {
  test("places pinned sessions first in chronological order without duplicating them", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("older", localDate(2026, 1, 28, 12)),
      createSession("yesterday", localDate(2026, 2, 19, 18)),
      createSession("today", localDate(2026, 2, 20, 10)),
    ];

    expect(summarizeGroups(groupSessions(sessions, ["older", "today"], now))).toEqual([
      { label: "Pinned", sessions: ["today", "older"] },
      { label: "Yesterday", sessions: ["yesterday"] },
    ]);
  });

  test("labels today's unpinned sessions only when a pinned group is present", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("today", localDate(2026, 2, 20, 10)),
      createSession("older", localDate(2026, 1, 28, 12)),
    ];

    expect(summarizeGroups(groupSessions(sessions, ["older"], now))).toEqual([
      { label: "Pinned", sessions: ["older"] },
      { label: "Today", sessions: ["today"] },
    ]);
    expect(summarizeGroups(groupSessions(sessions, [], now))).toEqual([
      { label: undefined, sessions: ["today"] },
      { label: "Older", sessions: ["older"] },
    ]);
  });

  test("ignores pinned IDs that are absent from the supplied sessions", () => {
    const sessions = [createSession("today", localDate(2026, 2, 20, 10))];

    expect(
      summarizeGroups(groupSessions(sessions, ["missing"], localDate(2026, 2, 20, 14))),
    ).toEqual([{ label: undefined, sessions: ["today"] }]);
  });

  test("sorts unpinned sessions chronologically before grouping them", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("yesterday", localDate(2026, 2, 19, 18)),
      createSession("today-earlier", localDate(2026, 2, 20, 9)),
      createSession("today-later", localDate(2026, 2, 20, 13)),
    ];

    expect(summarizeGroups(groupSessions(sessions, [], now))).toEqual([
      { label: undefined, sessions: ["today-later", "today-earlier"] },
      { label: "Yesterday", sessions: ["yesterday"] },
    ]);
  });
});
