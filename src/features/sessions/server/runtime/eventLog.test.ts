import { describe, expect, test } from "bun:test";
import { createSessionEventLog } from "./eventLog";
import type { SessionEvent } from "@sessions/model";

function event(content: string): SessionEvent {
  return { type: "delta", content };
}

describe("session event log replay", () => {
  test("covers its floor with every retained event", () => {
    const log = createSessionEventLog(10, 0);
    const one = log.publish(event("one"));
    const two = log.publish(event("two"));

    expect(log.replay(0)).toEqual([one, two]);

    const seeded = createSessionEventLog(10, one.revision!);
    const next = seeded.publish(event("next"));
    expect(seeded.replay(one.revision)).toEqual([next]);
  });

  test("does not cover a subscriber without a cursor", () => {
    const log = createSessionEventLog(10, 0);
    log.publish(event("one"));

    expect(log.replay()).toBeUndefined();
  });

  test("covers a retained revision with the events after it", () => {
    const log = createSessionEventLog(10, 0);
    const one = log.publish(event("one"));
    const two = log.publish(event("two"));
    const three = log.publish(event("three"));

    expect(log.replay(one.revision)).toEqual([two, three]);
    expect(log.replay(three.revision)).toEqual([]);
  });

  test("does not cover a revision it never published, even one inside its range", () => {
    const log = createSessionEventLog(10, 0);
    const one = log.publish(event("one"));
    const foreign = createSessionEventLog(10, 0).publish(event("foreign"));
    log.publish(event("two"));

    expect(foreign.revision).toBeGreaterThan(one.revision!);
    expect(log.replay(foreign.revision)).toBeUndefined();
  });

  test("trimming raises the floor past the events it drops", () => {
    const log = createSessionEventLog(2, 0);
    const one = log.publish(event("one"));
    const two = log.publish(event("two"));
    const three = log.publish(event("three"));

    expect(log.replay(one.revision)).toEqual([two, three]);
    expect(log.replay(0)).toBeUndefined();
  });
});

describe("session event log listeners", () => {
  test("notifies listeners synchronously until they unsubscribe", () => {
    const log = createSessionEventLog(10, 0);
    const received: SessionEvent[] = [];
    const unsubscribe = log.subscribe((published) => void received.push(published));

    const one = log.publish(event("one"));
    unsubscribe();
    log.publish(event("two"));

    expect(received).toEqual([one]);
  });

  test("lets every listener unsubscribe itself during a publish", () => {
    const log = createSessionEventLog(10, 0);
    const received: string[] = [];
    for (const name of ["first", "second"]) {
      const unsubscribe = log.subscribe(() => {
        received.push(name);
        unsubscribe();
      });
    }

    log.publish(event("one"));
    log.publish(event("two"));

    expect(received).toEqual(["first", "second"]);
  });
});

test("keeps revisions monotonic across logs after a synchronous burst", () => {
  const first = createSessionEventLog(1, 0);
  let last = first.publish(event("0"));
  for (let index = 1; index < 2_000; index++) {
    last = first.publish(event(String(index)));
  }

  const second = createSessionEventLog(1, 0);
  expect(second.publish(event("next")).revision).toBeGreaterThan(last.revision!);
});
