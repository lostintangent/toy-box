import { describe, expect, test } from "bun:test";
import type { SessionMetadata } from "@/types";
import { buildSessionListEntries, getSessionTimeBucket } from "./sessionGrouping";

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

describe("session grouping", () => {
  test("returns no entries for an empty list", () => {
    expect(buildSessionListEntries([], localDate(2026, 2, 20, 14))).toEqual([]);
  });

  test("does not insert headings for today sessions", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("s1", localDate(2026, 2, 20, 13)),
      createSession("s2", localDate(2026, 2, 20, 9)),
    ];

    const entries = buildSessionListEntries(sessions, now);

    expect(entries.map((entry) => entry.type)).toEqual(["session", "session"]);
  });

  test("inserts headings at bucket transitions after today", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("today", localDate(2026, 2, 20, 10)),
      createSession("yesterday", localDate(2026, 2, 19, 18)),
      createSession("this-week", localDate(2026, 2, 17, 12)),
      createSession("this-month", localDate(2026, 2, 3, 12)),
      createSession("older", localDate(2026, 1, 28, 12)),
    ];

    const entries = buildSessionListEntries(sessions, now);

    expect(entries.map((entry) => entry.type)).toEqual([
      "session",
      "heading",
      "session",
      "heading",
      "session",
      "heading",
      "session",
      "heading",
      "session",
    ]);
    expect(
      entries
        .filter((entry) => entry.type === "heading")
        .map((entry) =>
          entry.type === "heading"
            ? {
                label: entry.label,
                count: entry.count,
              }
            : null,
        ),
    ).toEqual([
      { label: "Yesterday", count: 1 },
      { label: "This Week", count: 1 },
      { label: "This Month", count: 1 },
      { label: "Older", count: 1 },
    ]);
  });

  test("inserts a heading before the first non-today bucket", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("yesterday", localDate(2026, 2, 19, 10)),
      createSession("this-week", localDate(2026, 2, 17, 10)),
    ];

    const entries = buildSessionListEntries(sessions, now);

    expect(entries[0]).toMatchObject({
      type: "heading",
      label: "Yesterday",
      bucket: "yesterday",
    });
  });

  test("adds one heading per contiguous bucket segment", () => {
    const now = localDate(2026, 2, 20, 14);
    const sessions = [
      createSession("yesterday-a", localDate(2026, 2, 19, 21)),
      createSession("yesterday-b", localDate(2026, 2, 19, 9)),
      createSession("this-week-a", localDate(2026, 2, 18, 17)),
      createSession("this-week-b", localDate(2026, 2, 17, 8)),
    ];

    const entries = buildSessionListEntries(sessions, now);
    const headings = entries
      .filter((entry) => entry.type === "heading")
      .map((entry) =>
        entry.type === "heading"
          ? {
              label: entry.label,
              count: entry.count,
            }
          : null,
      );

    expect(headings).toEqual([
      { label: "Yesterday", count: 2 },
      { label: "This Week", count: 2 },
    ]);
    expect(entries.map((entry) => entry.type)).toEqual([
      "heading",
      "session",
      "session",
      "heading",
      "session",
      "session",
    ]);
  });

  test("classifies month and older boundaries deterministically", () => {
    const now = localDate(2026, 2, 20, 14);

    expect(getSessionTimeBucket(localDate(2026, 2, 1, 0), now)).toBe("thisMonth");
    expect(getSessionTimeBucket(localDate(2026, 1, 31, 23), now)).toBe("older");
  });

  test("uses a rolling last-7-days window for this week", () => {
    const now = localDate(2026, 2, 6, 14);

    expect(getSessionTimeBucket(localDate(2026, 1, 31, 12), now)).toBe("thisWeek");
    expect(getSessionTimeBucket(localDate(2026, 1, 29, 12), now)).toBe("older");
  });
});
