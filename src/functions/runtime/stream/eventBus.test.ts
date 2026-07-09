import { describe, expect, test } from "bun:test";
import { createSessionEventBus } from "./eventBus";
import type { SessionEvent } from "@/types";

function event(content: string): SessionEvent {
  return { type: "delta", content };
}

function createTestBus(capacity = 10) {
  return createSessionEventBus({ capacity });
}

async function nextValue<T>(iterator: AsyncIterator<T>): Promise<T> {
  const result = await iterator.next();
  expect(result.done).toBe(false);
  return result.value!;
}

describe("session event bus replay and live delivery", () => {
  test("stamps dense event ids as events are published", () => {
    const bus = createTestBus();

    const one = bus.publish(event("one"));
    const two = bus.publish(event("two"));

    expect(one).toEqual(expect.objectContaining({ type: "delta", content: "one" }));
    expect(one.eventId).toEqual(expect.any(Number));
    expect(two.eventId).toBe(one.eventId! + 1);
  });

  test("replays retained events after a cursor, then streams live appends", async () => {
    const bus = createTestBus();
    const one = bus.publish(event("one"));
    const two = bus.publish(event("two"));
    const three = bus.publish(event("three"));

    const subscription = bus.subscribe(one.eventId);
    const four = bus.publish(event("four"));

    expect(await nextValue(subscription)).toEqual(two);
    expect(await nextValue(subscription)).toEqual(three);
    expect(await nextValue(subscription)).toEqual(four);

    await subscription.return();
  });

  test("registers active and passive subscribers before the first pull", async () => {
    const bus = createTestBus();
    const passive = bus.subscribe(undefined, "passive");

    expect(bus.hasReplayEvents).toBe(false);
    expect(bus.hasSubscribers).toBe(true);
    expect(bus.hasActiveSubscribers).toBe(false);

    const subscription = bus.subscribe();
    expect(bus.hasActiveSubscribers).toBe(true);

    const live = bus.publish(event("live"));

    expect(await nextValue(subscription)).toEqual(live);

    await subscription.return();
    expect(bus.hasSubscribers).toBe(true);
    expect(bus.hasActiveSubscribers).toBe(false);

    await passive.return();
  });
});

describe("session event bus retention", () => {
  test("caps replay history to the newest events", () => {
    const bus = createTestBus(3);

    bus.publish(event("one"));
    const two = bus.publish(event("two"));
    const three = bus.publish(event("three"));
    const four = bus.publish(event("four"));

    expect(bus.replaySince()).toEqual([two, three, four]);
    expect(bus.hasReplayEvents).toBe(true);
  });

  test("returns defensive replay copies", () => {
    const bus = createTestBus();
    const one = bus.publish(event("one"));
    const two = bus.publish(event("two"));

    const copy = bus.replaySince();
    copy.length = 0;

    expect(bus.replaySince()).toEqual([one, two]);
  });
});

describe("session event bus lifecycle", () => {
  test("clearReplay drops replay history without closing live subscribers", async () => {
    const bus = createTestBus();
    const subscription = bus.subscribe();

    const old = bus.publish(event("old"));
    bus.clearReplay();
    const live = bus.publish(event("live"));

    expect(bus.replaySince()).toEqual([live]);
    expect(bus.hasSubscribers).toBe(true);
    expect(await nextValue(subscription)).toEqual(old);
    expect(await nextValue(subscription)).toEqual(live);

    await subscription.return();
  });

  test("close lets subscribers drain queued events, then completes", async () => {
    const bus = createTestBus();
    const retained = bus.publish(event("retained"));

    const subscription = bus.subscribe();
    const live = bus.publish(event("live"));
    bus.close();

    expect(bus.hasSubscribers).toBe(false);
    expect(await nextValue(subscription)).toEqual(retained);
    expect(await nextValue(subscription)).toEqual(live);
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
  });

  test("unsubscribe stops live delivery and updates subscriber state", async () => {
    const bus = createTestBus();
    const subscription = bus.subscribe();

    await subscription.return();
    bus.publish(event("ignored"));

    expect(bus.hasSubscribers).toBe(false);
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
  });
});
