import { describe, expect, test } from "bun:test";
import { SerialTaskQueue } from "./serialTaskQueue";

describe("SerialTaskQueue", () => {
  test("runs tasks in order and preserves their results", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      events.push("first started");
      await firstGate;
      events.push("first finished");
      return "first result";
    });
    const second = queue.enqueue(async () => {
      events.push("second");
      return "second result";
    });

    await Promise.resolve();
    expect(events).toEqual(["first started"]);
    releaseFirst();

    expect(await first).toBe("first result");
    expect(await second).toBe("second result");
    expect(events).toEqual(["first started", "first finished", "second"]);
  });

  test("continues after returning a task failure to its caller", async () => {
    const queue = new SerialTaskQueue();
    const failure = new Error("failed");

    const rejected = queue.enqueue(async () => {
      throw failure;
    });
    const rejectedPending = queue.waitForPending();
    const recovered = queue.enqueue(async () => "recovered");
    const rejectedResult = rejected.catch((error: unknown) => error);
    const rejectedPendingResult = rejectedPending.catch((error: unknown) => error);

    expect(await rejectedResult).toBe(failure);
    expect(await rejectedPendingResult).toBe(failure);
    expect(await recovered).toBe("recovered");
  });

  test("waits for the tasks pending at call time", async () => {
    const queue = new SerialTaskQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;

    void queue.enqueue(() => gate);
    const pending = queue.waitForPending().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await pending;
    expect(settled).toBe(true);
  });
});
