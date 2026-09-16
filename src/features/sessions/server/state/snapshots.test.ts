import { beforeEach, describe, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as providers from "../providers";
import { deleteSessionFiles, writeSessionArtifact } from "../artifacts";
import type { SessionEvent, SessionSnapshot } from "@sessions/model";
import {
  cacheSnapshot,
  evictCachedSnapshot,
  getCachedSnapshot,
  hasCachedSnapshot,
  isCachedSnapshotFresh,
  loadSessionSnapshot,
  retainSessionSnapshots,
} from "@sessions/server/state/snapshots";

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

  test("serves recent snapshots only while the provider confirms their history", () => {
    expect(isCachedSnapshotFresh(entry, true, entry.capturedAt + 60_000)).toBe(true);
    expect(isCachedSnapshotFresh(entry, false, entry.capturedAt + 60_000)).toBe(false);
  });
  test("expires retained history after the cache TTL", () => {
    expect(isCachedSnapshotFresh(entry, true, entry.capturedAt + 25 * 60 * 60 * 1000)).toBe(false);
  });
});

describe.serial("snapshot cache", () => {
  beforeEach(async () => {
    await clearSnapshotCache();
  });

  test("cold and cached snapshots derive artifacts from current files", async () => {
    const sessionId = `toy-box-test-${crypto.randomUUID()}`;
    spyOn(providers, "isHistoryCurrent").mockResolvedValue(true);
    onTestFinished(async () => {
      mock.restore();
      evictCachedSnapshot(sessionId);
      await deleteSessionFiles(sessionId);
    });
    await writeSessionArtifact(sessionId, "current.html", "Current artifact");
    await withProviderHistory(async () => {
      expect((await loadSessionSnapshot(sessionId)).artifacts).toEqual(["current.html"]);
      await deleteSessionFiles(sessionId);
      expect((await getCachedSnapshot(sessionId))?.artifacts).toBeUndefined();
      evictCachedSnapshot(sessionId);
      expect((await loadSessionSnapshot(sessionId)).artifacts).toBeUndefined();
    }, [{ type: "assistant_message", content: "Created deleted.md" }]);
  });

  test("stores and serves snapshots as private copies", async () => {
    spyOn(providers, "isHistoryCurrent").mockResolvedValue(true);
    onTestFinished(() => {
      mock.restore();
      evictCachedSnapshot("snapshot-cache-test-clone");
    });

    const original = snapshot("snapshot-cache-test-clone");
    cacheSnapshot("snapshot-cache-test-clone", original);

    // Mutating the caller's object after caching must not reach the cache...
    original.messages[0]! = { role: "assistant", content: "mutated by the producer" };
    const served = await getCachedSnapshot("snapshot-cache-test-clone");
    expect(served?.messages[0]).toEqual({
      role: "assistant",
      content: "final response for snapshot-cache-test-clone",
    });

    // ...and mutating a served snapshot (e.g. a snapshot-seeded stream's late
    // tool completion) must not corrupt what the cache serves next.
    served!.messages[0]! = { role: "assistant", content: "mutated by a reader" };
    const servedAgain = await getCachedSnapshot("snapshot-cache-test-clone");
    expect(servedAgain?.messages[0]).toEqual({
      role: "assistant",
      content: "final response for snapshot-cache-test-clone",
    });
  });

  test("eviction removes a session's snapshot", () => {
    cacheSnapshot("snapshot-cache-test-evicted", snapshot("snapshot-cache-test-evicted"));
    evictCachedSnapshot("snapshot-cache-test-evicted");

    expect(hasCachedSnapshot("snapshot-cache-test-evicted")).toBe(false);
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
    spyOn(providers, "isHistoryCurrent").mockResolvedValue(false);
    onTestFinished(() => mock.restore());
    const sessionId = "snapshot-cache-test-missing-log";
    cacheSnapshot(sessionId, snapshot(sessionId));

    expect(await getCachedSnapshot(sessionId)).toBeUndefined();
    expect(hasCachedSnapshot(sessionId)).toBe(false);
  });

  test("retaining warms a cold session and keeps its slot through rotation", async () => {
    await withProviderHistory(async () => {
      await retainSessionSnapshots(["retained-0"]);
      expect(hasCachedSnapshot("retained-0")).toBe(true);

      for (let index = 0; index <= 10; index++) {
        cacheSnapshot(`transient-${index}`, snapshot(`transient-${index}`));
      }

      expect(hasCachedSnapshot("retained-0")).toBe(true);
      // The cap still governs the transient tail around it.
      expect(hasCachedSnapshot("transient-0")).toBe(false);
      expect(hasCachedSnapshot("transient-10")).toBe(true);
    });
  });

  test("replacing the retained set returns the previous sessions to rotation", async () => {
    await withProviderHistory(async () => {
      await retainSessionSnapshots(["released-0"]);
      await retainSessionSnapshots([]);

      for (let index = 0; index <= 10; index++) {
        cacheSnapshot(`churn-${index}`, snapshot(`churn-${index}`));
      }

      expect(hasCachedSnapshot("released-0")).toBe(false);
    });
  });
});

/** Keep snapshot replay local to the supplied canonical provider history. */
async function withProviderHistory(
  run: () => Promise<void>,
  events: SessionEvent[] = [],
): Promise<void> {
  const history = spyOn(providers, "readSessionHistory").mockResolvedValue(events);

  try {
    await run();
  } finally {
    history.mockRestore();
  }
}

async function clearSnapshotCache(): Promise<void> {
  // Retained entries are exempt from rotation, so release them before flushing.
  await retainSessionSnapshots([]);

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
