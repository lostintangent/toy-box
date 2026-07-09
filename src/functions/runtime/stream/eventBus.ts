// Per-session event bus: bounded replay plus live fan-out for canonical
// SessionEvents. Subscribing registers immediately, before the caller starts
// pulling, so producers can publish synchronously without losing the first
// event. Subscription mode is observation metadata; SessionStream owns the
// policy that distinguishes active from passive observers.
//
// The shared replay history is capped; each subscriber's pending live queue is
// not. Consumers should keep reading or cancel the subscription.

import type { SessionEvent } from "@/types";
import type { SessionSubscriptionMode } from "@/lib/session/protocol";

export type SessionStreamSubscription = AsyncIterableIterator<SessionEvent> & {
  return(value?: unknown): Promise<IteratorResult<SessionEvent>>;
};

type SessionEventBus = {
  publish(event: SessionEvent): SessionEvent;
  subscribe(afterEventId?: number, mode?: SessionSubscriptionMode): SessionStreamSubscription;
  replaySince(afterEventId?: number): SessionEvent[];
  clearReplay(): void;
  close(): void;
  readonly hasReplayEvents: boolean;
  readonly hasSubscribers: boolean;
  readonly hasActiveSubscribers: boolean;
};

type StampedSessionEvent = SessionEvent & { eventId: number };
type PendingRead = (event: SessionEvent | undefined) => void;

type SessionSubscriber = {
  pendingEvents: SessionEvent[];
  disconnected: boolean;
  mode: SessionSubscriptionMode;
  resumePendingRead?: PendingRead;
};

// Last event id issued in this process. The first event uses a Date.now seed;
// every later event increments that seed densely. A burst faster than 1
// event/ms therefore cannot hand a replacement stream a lower id, which would
// make the client's lastSeenEventId filter silently drop the next turn.
let lastIssuedEventId = 0;

function nextEventId(): number {
  lastIssuedEventId = lastIssuedEventId === 0 ? Date.now() : lastIssuedEventId + 1;
  return lastIssuedEventId;
}

export function createSessionEventBus(options: {
  capacity: number;
  onNoSubscribers?: () => void;
}): SessionEventBus {
  const history: StampedSessionEvent[] = [];
  const subscribers = new Set<SessionSubscriber>();
  let closed = false;

  function replaySince(afterEventId?: number): SessionEvent[] {
    if (afterEventId === undefined) return [...history];
    return history.filter((event) => event.eventId > afterEventId);
  }

  function publishToSubscriber(subscriber: SessionSubscriber, event: SessionEvent): void {
    if (subscriber.disconnected) return;

    if (subscriber.resumePendingRead) {
      const resumePendingRead = subscriber.resumePendingRead;
      subscriber.resumePendingRead = undefined;
      resumePendingRead(event);
      return;
    }

    subscriber.pendingEvents.push(event);
  }

  function disconnectSubscriber(subscriber: SessionSubscriber, notifyWhenEmpty = true): void {
    if (subscriber.disconnected) return;

    subscriber.disconnected = true;
    subscribers.delete(subscriber);
    if (subscriber.resumePendingRead && subscriber.pendingEvents.length === 0) {
      const resumePendingRead = subscriber.resumePendingRead;
      subscriber.resumePendingRead = undefined;
      resumePendingRead(undefined);
    }

    if (notifyWhenEmpty && subscribers.size === 0) {
      options.onNoSubscribers?.();
    }
  }

  function readNextEvent(subscriber: SessionSubscriber): Promise<SessionEvent | undefined> {
    if (subscriber.pendingEvents.length > 0) {
      return Promise.resolve(subscriber.pendingEvents.shift()!);
    }

    if (subscriber.disconnected) {
      return Promise.resolve(undefined);
    }

    return new Promise((resumePendingRead) => {
      subscriber.resumePendingRead = resumePendingRead;
    });
  }

  function createSubscription(subscriber: SessionSubscriber): SessionStreamSubscription {
    let finished = false;

    function finish(): IteratorResult<SessionEvent> {
      if (!finished) {
        finished = true;
        disconnectSubscriber(subscriber);
      }
      return { done: true, value: undefined };
    }

    return {
      [Symbol.asyncIterator]() {
        return this;
      },

      async next() {
        if (finished) return { done: true, value: undefined };

        const event = await readNextEvent(subscriber);
        return event === undefined ? finish() : { done: false, value: event };
      },

      async return() {
        return finish();
      },
    };
  }

  return {
    publish(event) {
      const published: StampedSessionEvent = { ...event, eventId: nextEventId() };
      if (closed) return published;

      history.push(published);
      if (history.length > options.capacity) {
        history.splice(0, history.length - options.capacity);
      }

      for (const subscriber of subscribers) {
        publishToSubscriber(subscriber, published);
      }

      return published;
    },

    subscribe(afterEventId, mode = "active") {
      const subscriber: SessionSubscriber = {
        pendingEvents: replaySince(afterEventId),
        disconnected: closed,
        mode,
      };

      if (!closed) {
        subscribers.add(subscriber);
      }

      return createSubscription(subscriber);
    },

    replaySince,

    clearReplay() {
      // Existing subscribers keep their pending events; only future replay is cleared.
      history.length = 0;
    },

    close() {
      if (closed) return;
      closed = true;

      for (const subscriber of subscribers) {
        disconnectSubscriber(subscriber, false);
      }
    },

    get hasReplayEvents() {
      return history.length > 0;
    },

    get hasSubscribers() {
      return subscribers.size > 0;
    },

    get hasActiveSubscribers() {
      for (const subscriber of subscribers) {
        if (subscriber.mode === "active") return true;
      }
      return false;
    },
  };
}
