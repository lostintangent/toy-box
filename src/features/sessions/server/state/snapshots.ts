// Session snapshot cache and cold-path loader. Live streams own active state;
// idle sessions resolve from this in-memory snapshot first, then SDK history.
//
// Freshness is guarded by the SDK event log mtime so out-of-process writes
// force a replay, with a small grace window for the SDK's trailing flush.
//
// Retained sessions keep their slot through rotation, so a session the
// workspace has declared interest in survives ordinary churn.

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { withSession } from "./registry";
import { replaySdkHistory } from "@sessions/server/sdk/historyReplay";
import { SESSION_STATE_PATH } from "@sessions/model/constants";
import { toSessionSnapshot } from "@sessions/model/reducer";
import { sharedMap, sharedSet } from "@/shared/server/processState";
import type { SessionSnapshot } from "@sessions/model";

const SNAPSHOT_CACHE_MAX_ENTRIES = 10;
const SNAPSHOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Log writes inside this window are treated as the SDK flushing the turn we
// already reflected in the snapshot, not new content.
const EVENTS_LOG_WRITE_GRACE_MS = 2_000;

export type CachedSnapshotEntry = {
  snapshot: SessionSnapshot;
  capturedAt: number;
};

const snapshotCache = sharedMap<CachedSnapshotEntry>("session-snapshot-cache");
const retainedSessionIds = sharedSet<string>("retained-session-snapshots");

/** Load an idle session snapshot from cache, or replay SDK history and cache it. */
export async function loadSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const cachedSnapshot = await getCachedSnapshot(sessionId);
  if (cachedSnapshot) return cachedSnapshot;

  const events = await withSession(sessionId, (session) => session.getEvents());
  const snapshot = toSessionSnapshot(sessionId, replaySdkHistory(sessionId, events));

  cacheSnapshot(sessionId, snapshot);
  return snapshot;
}

/** Rebuild one idle snapshot from authoritative SDK history without changing retention. */
export async function refreshSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  snapshotCache.delete(sessionId);
  return loadSessionSnapshot(sessionId);
}

/**
 * Declare the sessions whose snapshots must stay warm, replacing any previous
 * declaration. Cold sessions are loaded and every retained session keeps its
 * cache slot. Resolves once warming settles and never rejects, so callers can
 * declare interest without waiting on SDK history replay.
 */
export async function retainSessionSnapshots(sessionIds: readonly string[]): Promise<void> {
  retainedSessionIds.clear();
  for (const sessionId of sessionIds) retainedSessionIds.add(sessionId);

  // Retention is declared before loading so warming a set larger than the cap
  // cannot rotate out the very snapshots it is warming.
  await Promise.all(
    sessionIds.map((sessionId) =>
      loadSessionSnapshot(sessionId).catch((error) => {
        console.error(`Unable to warm the snapshot for session ${sessionId}:`, error);
      }),
    ),
  );
}

/** Cache a private copy of a reduced session snapshot. */
export function cacheSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
  snapshotCache.delete(sessionId);
  snapshotCache.set(sessionId, { snapshot: structuredClone(snapshot), capturedAt: Date.now() });

  // Rotate out the least recently used entries until the cache fits, skipping
  // retained sessions. The cap therefore governs the transient tail.
  for (const cachedSessionId of snapshotCache.keys()) {
    if (snapshotCache.size <= SNAPSHOT_CACHE_MAX_ENTRIES) return;
    if (retainedSessionIds.has(cachedSessionId)) continue;
    snapshotCache.delete(cachedSessionId);
  }
}

/** Return a fresh cached snapshot copy, evicting stale entries. */
export async function getCachedSnapshot(sessionId: string): Promise<SessionSnapshot | undefined> {
  const entry = snapshotCache.get(sessionId);
  if (!entry) return undefined;

  if (!isCachedSnapshotFresh(entry, await readEventsLogMtimeMs(sessionId), Date.now())) {
    snapshotCache.delete(sessionId);
    return undefined;
  }

  // Refresh recency so sessions the user keeps returning to stay cached.
  snapshotCache.delete(sessionId);
  snapshotCache.set(sessionId, entry);
  return structuredClone(entry.snapshot);
}

/** Forget a session's snapshot entirely, including any retention it was granted. */
export function evictCachedSnapshot(sessionId: string): void {
  snapshotCache.delete(sessionId);
  retainedSessionIds.delete(sessionId);
}

/** Whether a session currently occupies a cache slot (fresh or not). */
export function hasCachedSnapshot(sessionId: string): boolean {
  return snapshotCache.has(sessionId);
}

/** Whether a cached snapshot is still truthful enough to serve. */
export function isCachedSnapshotFresh(
  entry: CachedSnapshotEntry,
  eventsLogMtimeMs: number | undefined,
  now: number,
): boolean {
  if (now - entry.capturedAt > SNAPSHOT_CACHE_TTL_MS) return false;
  if (eventsLogMtimeMs === undefined) return false;
  return eventsLogMtimeMs <= entry.capturedAt + EVENTS_LOG_WRITE_GRACE_MS;
}

async function readEventsLogMtimeMs(sessionId: string): Promise<number | undefined> {
  try {
    const eventsPath = join(homedir(), SESSION_STATE_PATH, sessionId, "events.jsonl");
    return (await stat(eventsPath)).mtimeMs;
  } catch {
    return undefined;
  }
}
