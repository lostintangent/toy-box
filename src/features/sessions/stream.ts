/**
 * Observes one session for as long as an enabled observer watches its detail. The
 * observation opens with a snapshot, follows each run the session's shared activity
 * announces from the cached cursor, and heals with a snapshot once the run ends.
 */

import {
  hashKey,
  matchMutation,
  type QueryFunctionContext,
  type QueryKey,
} from "@tanstack/react-query";
import { readEventStream } from "@/shared/sse";
import type { SessionEvent, SessionState } from "./model";
import { isLiveActivity, type SessionActivity, type SessionsActivity } from "./model/activity";

/** What an observation writes to a session's detail. */
export type SessionObservation =
  | { type: "snapshot"; state: SessionState }
  | { type: "events"; events: SessionEvent[] };

export async function* streamSession(
  { client, queryKey, signal }: QueryFunctionContext,
  {
    sessionId,
    activityKey,
    readSnapshot,
  }: {
    sessionId: string;
    activityKey: QueryKey;
    readSnapshot: (signal: AbortSignal) => Promise<SessionState>;
  },
): AsyncGenerator<SessionObservation> {
  const queryCache = client.getQueryCache();
  const detailHash = hashKey(queryKey);
  const activityHash = hashKey(activityKey);
  const readActivity = () => client.getQueryData<SessionsActivity>(activityKey)?.[sessionId];
  const readState = () => client.getQueryData<SessionState>(queryKey);
  // This client's deliveries carry the detail's key, so the observation can wait for them.
  const deliveries = { mutationKey: queryKey, exact: true };
  const isDelivering = () => client.isMutating(deliveries) > 0;

  let changed = () => {};
  /** Waits until `ready` holds, and reports whether the detail is still watched. */
  const until = async (ready: () => boolean) => {
    while (!signal.aborted && !ready()) {
      await new Promise<void>((resolve) => (changed = resolve));
    }
    return !signal.aborted;
  };

  let activity = readActivity();
  // A run this observation has neither followed nor healed.
  let unseen = isLiveActivity(activity?.status);
  let deliveriesStarted = 0;
  let opened = false;

  signal.addEventListener("abort", () => changed(), { once: true });
  const stopQueries = queryCache.subscribe(({ type, query }) => {
    if (query.queryHash === detailHash) {
      // Query cancels a fetch once its last observer leaves, but a pin's observer never watches.
      if (opened && !query.isActive()) void query.cancel({ revert: true });
    } else if (type === "updated" && query.queryHash === activityHash) {
      const next = readActivity();
      if (next === activity) return;
      if (announcesRun(activity, next)) unseen = true;
      activity = next;
      changed();
    }
  });
  const stopMutations = client.getMutationCache().subscribe(({ type, mutation }) => {
    if (!mutation || !matchMutation(deliveries, mutation)) return;
    if (type === "added") deliveriesStarted++;
    changed();
  });

  /** Reads a snapshot, unless this client's delivery holds an optimistic turn it would hide. */
  async function* readFresh(): AsyncGenerator<SessionObservation> {
    if (isDelivering()) return;
    const started = deliveriesStarted;
    const state = await readSnapshot(signal);
    if (deliveriesStarted === started) yield { type: "snapshot", state };
  }

  try {
    yield* readFresh();
    opened = true;
    // A prefetch only reads the snapshot.
    if (!queryCache.get(detailHash)?.isActive()) return;

    while (await until(() => unseen && !isDelivering())) {
      unseen = false;
      if (isLiveActivity(readActivity()?.status)) {
        // Show the run before its follow connects.
        if (readState()?.status === "idle") {
          yield { type: "events", events: [{ type: "status", status: "thinking" }] };
        }
        let received = false;
        try {
          for await (const events of follow(sessionId, readState()?.lastSeenEventId, signal)) {
            received = true;
            yield { type: "events", events };
          }
          // A live run ends with the server's `end`, so an event-less follow found none.
          if (!received) yield { type: "events", events: [{ type: "end", reason: "idle" }] };
        } catch (error) {
          if (signal.aborted) return;
          console.error("Session stream failed:", error);
          // Resume a live run after the last event received, or let the heal reread it.
          if (received) {
            unseen = true;
            continue;
          }
        }
      }
      yield* readFresh();
    }
  } catch (error) {
    // Only the opening snapshot fails the detail, so a missing session surfaces as an error.
    // After a failed heal it keeps its state, and its next restart reads what the heal missed.
    if (!opened) throw error;
    if (!signal.aborted) console.error("Session snapshot failed:", error);
  } finally {
    stopQueries();
    stopMutations();
  }
}

/** Whether activity announces a run this observation hasn't seen: a new live run, or
 *  a finished one whose live states it never saw. */
function announcesRun(previous: SessionActivity | undefined, next: SessionActivity | undefined) {
  if (next && "since" in next) {
    return !(previous && "since" in previous && previous.since === next.since);
  }
  return next?.status === "unread" && !previous;
}

/** Follows a session's events after a cursor in render batches. Deltas wait for the
 *  next animation frame, and any other event flushes the batch with it. */
async function* follow(
  sessionId: string,
  after: number | undefined,
  signal: AbortSignal,
): AsyncGenerator<SessionEvent[]> {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}`;
  const events = readEventStream<SessionEvent>(
    after === undefined ? url : `${url}?after=${after}`,
    signal,
  );
  const batch: SessionEvent[] = [];
  let next = events.next();
  let frame: Promise<void> | undefined;
  try {
    for (;;) {
      // A frame resolves to nothing.
      const result = await (frame ? Promise.race([next, frame]) : next);
      if (result?.done) break;
      if (result) {
        batch.push(result.value);
        next = events.next();
        if (isDelta(result.value)) {
          frame ??= nextFrame();
          continue;
        }
      }
      frame = undefined;
      yield batch.splice(0);
    }
    if (batch.length > 0) yield batch;
  } finally {
    // The observation stops reading only once `signal` aborts, which settles the read in flight.
    await next.catch(() => {});
  }
}

function isDelta(event: SessionEvent): boolean {
  return (
    event.type === "delta" || event.type === "reasoning_delta" || event.type === "tool_output_delta"
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
