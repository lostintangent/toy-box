// Per-execution session event log. Publishing stamps an event with the next
// process-wide revision, retains it in a bounded tail, and notifies listeners
// synchronously, so a subscriber that replays and then listens in one turn
// cannot miss an event.
//
// A cursor is covered when it is the log's floor (the revision of the state the
// log continues, or of its last trimmed event) or a retained event's revision.
// Any other cursor, or none, may have missed events, so replay reports it as
// uncovered rather than guess.

import type { SessionEvent } from "@sessions/model";

type StampedSessionEvent = SessionEvent & { revision: number };

// The first revision uses a Date.now seed and every later one increments it,
// so a replacement execution can never issue a revision below one a client
// already holds, even after a burst faster than one event per millisecond.
let lastRevision = 0;

export function nextRevision(): number {
  lastRevision = lastRevision === 0 ? Date.now() : lastRevision + 1;
  return lastRevision;
}

export function createSessionEventLog(capacity: number, floor: number) {
  const retained: StampedSessionEvent[] = [];
  const listeners = new Set<(event: SessionEvent) => void>();

  return {
    publish(event: SessionEvent): SessionEvent {
      const published = { ...event, revision: nextRevision() };
      retained.push(published);
      if (retained.length > capacity) floor = retained.shift()!.revision;
      for (const listener of [...listeners]) listener(published);
      return published;
    },

    /** The events after a covered cursor, or undefined when it may have missed some. */
    replay(after?: number): SessionEvent[] | undefined {
      if (after === floor) return [...retained];
      const index = retained.findIndex((event) => event.revision === after);
      return index === -1 ? undefined : retained.slice(index + 1);
    },

    subscribe(listener: (event: SessionEvent) => void): VoidFunction {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
