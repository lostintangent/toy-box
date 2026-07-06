import { describe, expect, test } from "bun:test";
import { createSessionStreamBuffer } from "./buffer";
import type { SessionEvent } from "@/types";

function event(content: string): SessionEvent {
  return { type: "delta", content };
}

function createTestBuffer(capacity = 10) {
  return createSessionStreamBuffer({ capacity });
}

async function nextValue<T>(iterator: AsyncIterator<T>): Promise<T> {
  const result = await iterator.next();
  expect(result.done).toBe(false);
  return result.value!;
}

describe("SessionStreamBuffer replay and live delivery", () => {
  test("stamps dense event ids as events are published", () => {
    const buffer = createTestBuffer();

    const one = buffer.publish(event("one"));
    const two = buffer.publish(event("two"));

    expect(one).toEqual(expect.objectContaining({ type: "delta", content: "one" }));
    expect(one.eventId).toEqual(expect.any(Number));
    expect(two.eventId).toBe(one.eventId! + 1);
  });

  test("replays buffered events after a cursor, then streams live appends", async () => {
    const buffer = createTestBuffer();
    const one = buffer.publish(event("one"));
    const two = buffer.publish(event("two"));
    const three = buffer.publish(event("three"));

    const subscription = buffer.subscribe(one.eventId);
    const four = buffer.publish(event("four"));

    expect(await nextValue(subscription)).toEqual(two);
    expect(await nextValue(subscription)).toEqual(three);
    expect(await nextValue(subscription)).toEqual(four);

    await subscription.return();
  });

  test("registers subscribers eagerly before the first pull", async () => {
    const buffer = createTestBuffer();
    const subscription = buffer.subscribe();

    expect(buffer.hasSubscribers).toBe(true);

    const live = buffer.publish(event("live"));

    expect(await nextValue(subscription)).toEqual(live);

    await subscription.return();
  });
});

describe("SessionStreamBuffer retention", () => {
  test("caps replay history to the newest events", () => {
    const buffer = createTestBuffer(3);

    buffer.publish(event("one"));
    const two = buffer.publish(event("two"));
    const three = buffer.publish(event("three"));
    const four = buffer.publish(event("four"));

    expect(buffer.bufferedCount).toBe(3);
    expect(buffer.replaySince()).toEqual([two, three, four]);
  });

  test("returns defensive replay copies", () => {
    const buffer = createTestBuffer();
    const one = buffer.publish(event("one"));
    const two = buffer.publish(event("two"));

    const replay = buffer.replaySince();
    replay.length = 0;

    expect(buffer.replaySince()).toEqual([one, two]);
  });
});

describe("SessionStreamBuffer lifecycle", () => {
  test("clearReplay drops replay history without closing live subscribers", async () => {
    const buffer = createTestBuffer();
    const subscription = buffer.subscribe();

    const old = buffer.publish(event("old"));
    buffer.clearReplay();
    const live = buffer.publish(event("live"));

    expect(buffer.replaySince()).toEqual([live]);
    expect(buffer.hasSubscribers).toBe(true);
    expect(await nextValue(subscription)).toEqual(old);
    expect(await nextValue(subscription)).toEqual(live);

    await subscription.return();
  });

  test("close lets subscribers drain queued events, then completes", async () => {
    const buffer = createTestBuffer();
    const replay = buffer.publish(event("replay"));

    const subscription = buffer.subscribe();
    const live = buffer.publish(event("live"));
    buffer.close();

    expect(buffer.hasSubscribers).toBe(false);
    expect(await nextValue(subscription)).toEqual(replay);
    expect(await nextValue(subscription)).toEqual(live);
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
  });

  test("unsubscribe stops live delivery and updates subscriber state", async () => {
    const buffer = createTestBuffer();
    const subscription = buffer.subscribe();

    await subscription.return();
    buffer.publish(event("ignored"));

    expect(buffer.hasSubscribers).toBe(false);
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
  });
});
