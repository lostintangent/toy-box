/**
 * Subscribes to one session for as long as an enabled observer watches its detail.
 * Each subscription brings the detail current from its revision, with a replay or a
 * snapshot, then streams the live run until it ends. The detail subscribes when it
 * opens and again for each run the session's shared activity announces.
 */

import {
  hashKey,
  matchMutation,
  type QueryFunctionContext,
  type QueryKey,
} from "@tanstack/react-query";
import { readEventStream } from "@/shared/sse";
import type { SessionState, SessionSubscriptionEvent } from "./model";
import type { SessionActivity, SessionsActivity } from "./model/activity";

export async function* streamSession(
  { client, queryKey, signal }: QueryFunctionContext,
  { sessionId, activityKey }: { sessionId: string; activityKey: QueryKey },
): AsyncGenerator<SessionSubscriptionEvent[]> {
  const queryCache = client.getQueryCache();
  const detailHash = hashKey(queryKey);
  const activityHash = hashKey(activityKey);
  const readActivity = () => client.getQueryData<SessionsActivity>(activityKey)?.[sessionId];
  const readState = () => client.getQueryData<SessionState>(queryKey);
  // This client's deliveries carry the detail's key, so a subscription can wait for them.
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
  // A run, or the opening state, this detail hasn't subscribed to yet.
  let unseen = true;
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

  try {
    // A pending delivery holds an optimistic turn that a snapshot would hide.
    while (await until(() => unseen && !isDelivering())) {
      unseen = false;
      const started = deliveriesStarted;
      let received = false;
      try {
        for await (const events of subscribe(sessionId, readState()?.revision, signal)) {
          if (events[0]?.type === "deleted") throw new Error(`Session not found: ${sessionId}`);
          received = true;
          // A delivery that started since subscribing may postdate the snapshot.
          if (events[0]?.type === "snapshot" && deliveriesStarted !== started) {
            unseen = true;
            break;
          }
          yield events;
          if (!opened && events.some(isCurrent)) {
            opened = true;
            // A prefetch only brings the detail current.
            if (!queryCache.get(detailHash)?.isActive()) return;
          }
        }
        if (!received)
          throw new Error(`Session subscription closed before any event: ${sessionId}`);
      } catch (error) {
        if (signal.aborted) return;
        if (!received) throw error;
        // Resubscribe from the last revision received.
        console.error("Session subscription failed:", error);
        unseen = true;
      }
    }
  } catch (error) {
    // Only the opening subscription fails the detail, so a missing session surfaces as an
    // error. Later, the detail keeps its state until its next restart brings it current.
    if (!opened) throw error;
    if (!signal.aborted) console.error("Session subscription failed:", error);
  } finally {
    stopQueries();
    stopMutations();
  }
}

/** Whether activity announces a run this detail hasn't subscribed to: a new live run, a
 *  finished one whose live states it never saw, or a stopped one, whose history can keep
 *  less than its live states showed. */
function announcesRun(previous: SessionActivity | undefined, next: SessionActivity | undefined) {
  if (next && "since" in next) {
    return !(previous && "since" in previous && previous.since === next.since);
  }
  if (!next) return previous !== undefined && "since" in previous;
  return next.status === "unread" && !previous;
}

/** Subscribes from a cursor and reads the subscription in render batches. Deltas wait
 *  for the next animation frame, and any other event flushes the batch with it. Leaving
 *  early closes the subscription. */
async function* subscribe(
  sessionId: string,
  after: number | undefined,
  signal: AbortSignal,
): AsyncGenerator<SessionSubscriptionEvent[]> {
  const subscription = new AbortController();
  const close = () => subscription.abort();
  signal.addEventListener("abort", close, { once: true });
  const url = `/api/sessions/${encodeURIComponent(sessionId)}`;
  const events = readEventStream<SessionSubscriptionEvent>(
    after === undefined ? url : `${url}?after=${after}`,
    subscription.signal,
  );
  const batch: SessionSubscriptionEvent[] = [];
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
    signal.removeEventListener("abort", close);
    // Aborting settles the read in flight.
    close();
    await next.catch(() => {});
  }
}

/** Whether a subscription event marks the detail current. */
function isCurrent(event: SessionSubscriptionEvent): boolean {
  return event.type === "snapshot" || event.type === "resumed";
}

function isDelta(event: SessionSubscriptionEvent): boolean {
  return (
    event.type === "delta" || event.type === "reasoning_delta" || event.type === "tool_output_delta"
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
