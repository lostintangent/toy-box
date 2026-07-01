// Session snapshot cache — the reduced SessionSnapshot of recently finished
// or recently opened sessions, so querySession can answer an idle open from
// memory instead of SDK resume + full-log replay. sessionCache caches live
// SDK session handles; this module caches what querySession would compute
// from them.
//
// The cache pays off when a client has no detail cached yet: automations that
// ran while nobody was watching, and sessions driven from another device.
// In-process writes are self-maintaining — every write path runs through a
// SessionStream whose clean close re-caches the final state — while
// out-of-band writes (e.g. the copilot CLI appending to the same session) are
// caught by comparing the session event log's mtime against the capture time,
// with a small grace window for the SDK's own trailing flush of the turn we
// just observed.

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SESSION_STATE_PATH } from "@/lib/session/sessionState";
import { sharedMap } from "../runtime/processState";
import type { SessionSnapshot } from "@/types";

const SNAPSHOT_CACHE_MAX_ENTRIES = 10;
const SNAPSHOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Log writes this soon after capture are the SDK flushing the turn we just
 *  observed, not new content; anything later means the log changed under us. */
const EVENTS_LOG_WRITE_GRACE_MS = 2_000;

export type CachedSnapshotEntry = {
  snapshot: SessionSnapshot;
  capturedAt: number;
};

const snapshotCache = sharedMap<CachedSnapshotEntry>("session-snapshot-cache");

/** Pure freshness policy: an entry serves until it ages out, its session's
 *  event log disappears, or the log was written meaningfully after capture. */
export function isCachedSnapshotFresh(
  entry: CachedSnapshotEntry,
  eventsLogMtimeMs: number | undefined,
  now: number,
): boolean {
  if (now - entry.capturedAt > SNAPSHOT_CACHE_TTL_MS) return false;
  if (eventsLogMtimeMs === undefined) return false;
  return eventsLogMtimeMs <= entry.capturedAt + EVENTS_LOG_WRITE_GRACE_MS;
}

/** Cache the final reduced form of a session, rotating out the least
 *  recently used entry beyond the cap. Synchronous so stream teardown can
 *  call it inline. */
export function cacheSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
  snapshotCache.delete(sessionId);
  snapshotCache.set(sessionId, { snapshot, capturedAt: Date.now() });

  while (snapshotCache.size > SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = snapshotCache.keys().next().value;
    if (oldest === undefined) return;
    snapshotCache.delete(oldest);
  }
}

/** The cached snapshot for a session, if one is present and still fresh.
 *  Stale entries are dropped so the caller's cold path repopulates them. */
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
  return entry.snapshot;
}

export function evictCachedSnapshot(sessionId: string): void {
  snapshotCache.delete(sessionId);
}

/** Whether a session currently occupies a cache slot (fresh or not). */
export function hasCachedSnapshot(sessionId: string): boolean {
  return snapshotCache.has(sessionId);
}

async function readEventsLogMtimeMs(sessionId: string): Promise<number | undefined> {
  try {
    const eventsPath = join(homedir(), SESSION_STATE_PATH, sessionId, "events.jsonl");
    return (await stat(eventsPath)).mtimeMs;
  } catch {
    return undefined;
  }
}
