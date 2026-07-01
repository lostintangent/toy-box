import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionSnapshot } from "@/types";
import {
  cacheSnapshot,
  evictCachedSnapshot,
  getCachedSnapshot,
  hasCachedSnapshot,
  isCachedSnapshotFresh,
} from "@/functions/state/snapshotCache";

function snapshot(sessionId: string): SessionSnapshot {
  return {
    id: sessionId,
    messages: [{ role: "assistant", content: `final response for ${sessionId}` }],
    queuedMessages: [],
    status: "idle",
    reasoningContent: "",
  };
}

describe("cached snapshot freshness", () => {
  const entry = { snapshot: snapshot("A"), capturedAt: 1_000_000 };

  const cases: Array<{
    name: string;
    eventsLogMtimeMs: number | undefined;
    now: number;
    fresh: boolean;
  }> = [
    {
      name: "serves an entry whose log has not changed since capture",
      eventsLogMtimeMs: entry.capturedAt - 500,
      now: entry.capturedAt + 60_000,
      fresh: true,
    },
    {
      name: "tolerates the SDK's trailing log flush just after capture",
      eventsLogMtimeMs: entry.capturedAt + 1_500,
      now: entry.capturedAt + 60_000,
      fresh: true,
    },
    {
      name: "rejects an entry whose log was written meaningfully after capture",
      eventsLogMtimeMs: entry.capturedAt + 60_000,
      now: entry.capturedAt + 120_000,
      fresh: false,
    },
    {
      name: "rejects an entry whose log is missing",
      eventsLogMtimeMs: undefined,
      now: entry.capturedAt + 60_000,
      fresh: false,
    },
    {
      name: "rejects an entry older than the TTL",
      eventsLogMtimeMs: entry.capturedAt - 500,
      now: entry.capturedAt + 25 * 60 * 60 * 1000,
      fresh: false,
    },
  ];

  test.each(cases)("$name", (testCase) => {
    expect(isCachedSnapshotFresh(entry, testCase.eventsLogMtimeMs, testCase.now)).toBe(
      testCase.fresh,
    );
  });
});

describe.serial("snapshot cache", () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  test("rotates out the oldest entry beyond the cap", () => {
    for (let index = 0; index <= 10; index++) {
      cacheSnapshot(`rotate-${index}`, snapshot(`rotate-${index}`));
    }

    expect(hasCachedSnapshot("rotate-0")).toBe(false);
    expect(hasCachedSnapshot("rotate-1")).toBe(true);
    expect(hasCachedSnapshot("rotate-10")).toBe(true);
  });

  test("re-caching a session refreshes its rotation slot", () => {
    for (let index = 0; index <= 9; index++) {
      cacheSnapshot(`refresh-${index}`, snapshot(`refresh-${index}`));
    }

    // A fresh capture for the oldest entry moves it to the back of the
    // rotation, so the next insert evicts the second-oldest instead.
    cacheSnapshot("refresh-0", snapshot("refresh-0"));
    cacheSnapshot("refresh-10", snapshot("refresh-10"));

    expect(hasCachedSnapshot("refresh-1")).toBe(false);
    expect(hasCachedSnapshot("refresh-0")).toBe(true);
    expect(hasCachedSnapshot("refresh-10")).toBe(true);
  });

  test("drops entries whose session has no event log on disk", async () => {
    const sessionId = "snapshot-cache-test-missing-log";
    cacheSnapshot(sessionId, snapshot(sessionId));

    expect(await getCachedSnapshot(sessionId)).toBeUndefined();
    expect(hasCachedSnapshot(sessionId)).toBe(false);
  });

  test("eviction removes a session's snapshot", () => {
    cacheSnapshot("snapshot-cache-test-evicted", snapshot("snapshot-cache-test-evicted"));
    evictCachedSnapshot("snapshot-cache-test-evicted");

    expect(hasCachedSnapshot("snapshot-cache-test-evicted")).toBe(false);
  });
});

function clearSnapshotCache(): void {
  const resetSessionIds = Array.from(
    { length: 10 },
    (_, index) => `snapshot-cache-test-reset-${index}`,
  );

  for (const sessionId of resetSessionIds) {
    cacheSnapshot(sessionId, snapshot(sessionId));
  }

  for (const sessionId of resetSessionIds) {
    evictCachedSnapshot(sessionId);
  }
}
