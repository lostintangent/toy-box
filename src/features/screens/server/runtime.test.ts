import { expect, test } from "bun:test";
import type { ScreenFrame, ScreenStatus } from "../model";
import type { ScreenServerMessage } from "../model/protocol";
import type { CaptureEvent, ScreenHelper } from "./helper";
import { ScreenRuntime } from "./runtime";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A runtime over a scripted helper, with viewers that record what they receive. */
function setup() {
  const calls: string[] = [];
  const unavailable = new Set<string>();
  let launches = 0;
  let opening = Promise.resolve();
  let emit: (event: CaptureEvent, packet: Uint8Array) => void = () => {};
  // The runtime forwards each frame's packet unchanged, so viewers identify frames by packet.
  const frames = new Map<Uint8Array, ScreenFrame>();

  const record = (method: string) => async () => {
    calls.push(method);
  };
  const helper: ScreenHelper = {
    list: async () => ({ displays: [], windows: [] }),
    thumbnail: async () => "",
    async start(screenId) {
      calls.push("start");
      await opening;
      if (unavailable.has(screenId)) throw new Error("Screen is unavailable.");
      return "Test window";
    },
    stop: record("stop"),
    focus: record("focus"),
    input: record("input"),
    releaseInput: record("releaseInput"),
    close: record("close"),
  };
  const runtime = new ScreenRuntime(async (onEvent) => {
    launches++;
    emit = onEvent;
    return helper;
  });

  return {
    runtime,
    unavailable,
    calls,
    launches: () => launches,
    holdOpening(until: Promise<void>) {
      opening = until;
    },
    state(status: ScreenStatus, reason?: string) {
      emit({ type: "state", screenId: "window", status, reason }, new Uint8Array());
    },
    frame(sequence: number, region?: ScreenFrame["region"]) {
      const frame = { sequence, width: 4, height: 4, region };
      const packet = new Uint8Array();
      frames.set(packet, frame);
      emit({ type: "frame", screenId: "window", ...frame }, packet);
    },
    async view(viewerId = "viewer", screenId = "window") {
      const viewer = {
        frames: [] as ScreenFrame[],
        states: [] as Extract<ScreenServerMessage, { type: "state" }>[],
        closed: false,
        hasControl: () => viewer.states.at(-1)?.hasControl ?? false,
      };
      runtime.attach(screenId, {
        id: viewerId,
        send(data) {
          if (typeof data === "string") viewer.states.push(JSON.parse(data));
          else viewer.frames.push(frames.get(data)!);
        },
        close() {
          viewer.closed = true;
        },
      });
      await settle();
      return viewer;
    },
  };
}

test("viewers of one screen share a capture that opens once", async () => {
  const f = setup();
  const gate = Promise.withResolvers<void>();
  f.holdOpening(gate.promise);
  const [a, b] = [await f.view("a"), await f.view("b")];
  expect([a.states, b.states]).toEqual([[], []]);
  gate.resolve();
  await settle();
  expect(f.calls).toEqual(["start"]);
  for (const viewer of [a, b])
    expect(viewer.states).toEqual([
      { type: "state", title: "Test window", status: "live", hasControl: false },
    ]);
});

test("a screen that can't open tells its viewers why and closes them", async () => {
  const f = setup();
  f.unavailable.add("missing");
  const viewer = await f.view("viewer", "missing");
  expect(viewer.states).toEqual([
    { type: "state", status: "ended", reason: "Screen is unavailable.", hasControl: false },
  ]);
  expect(viewer.closed).toBe(true);
});

test("the last viewer to leave stops the capture, and the next viewer reopens it", async () => {
  const f = setup();
  await f.view("a");
  await f.view("b");
  f.runtime.detach("window", "a");
  await settle();
  expect(f.calls).toEqual(["start"]);
  f.runtime.detach("window", "b");
  await f.view("c");
  expect(f.calls).toEqual(["start", "stop", "start"]);
});

test("a viewer that leaves while its screen opens gets nothing, and the capture stops once open", async () => {
  const f = setup();
  const gate = Promise.withResolvers<void>();
  f.holdOpening(gate.promise);
  const viewer = await f.view();
  f.runtime.detach("window", "viewer");
  gate.resolve();
  await settle();
  expect(viewer.states).toEqual([]);
  expect(f.calls).toEqual(["start", "stop"]);
});

test("a screen that ends tells its viewers why, and a later viewer resolves its ID again", async () => {
  const f = setup();
  const viewer = await f.view();
  f.state("ended", "Window closed.");
  expect(viewer.states.at(-1)).toMatchObject({ status: "ended", reason: "Window closed." });
  expect(viewer.closed).toBe(true);
  f.unavailable.add("window");
  const later = await f.view("later");
  expect(later.states.at(-1)?.status).toBe("ended");
  expect(later.closed).toBe(true);
  expect(f.calls.filter((method) => method === "start")).toHaveLength(2);
});

test("slow viewers skip superseded frames without holding back others", async () => {
  const f = setup();
  const fast = await f.view("fast");
  const slow = await f.view("slow");
  f.frame(1);
  for (let sequence = 2; sequence <= 10; sequence++) {
    f.runtime.acknowledge("window", "fast", sequence - 1);
    f.frame(sequence);
  }
  expect(fast.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(slow.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3]);
  f.runtime.acknowledge("window", "slow", 1);
  expect(slow.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 10]);
});

test("a viewer that joins or falls behind gets the full frame before the newest region", async () => {
  const f = setup();
  const slow = await f.view();
  f.frame(1);
  const region = { x: 0, y: 0, width: 2, height: 2 };
  for (let sequence = 2; sequence <= 5; sequence++) f.frame(sequence, region);
  const joined = await f.view("joined");
  expect(joined.frames.map((frame) => frame.sequence)).toEqual([1, 5]);
  f.frame(6);
  f.frame(7, region);
  f.frame(8, { ...region, width: 0, height: 0 });
  f.runtime.acknowledge("window", "viewer", 2);
  expect(slow.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 6, 8]);
  expect(slow.frames.at(-1)?.region).toEqual({ ...region, width: 0, height: 0 });
});

test("taking control fences the previous controller's input, and releasing clears it", async () => {
  const f = setup();
  const a = await f.view("a");
  const b = await f.view("b");
  await f.runtime.takeControl("window", "a");
  const fenced = f.runtime.input("window", "a", []).catch((error: Error) => error);
  await f.runtime.takeControl("window", "b");
  expect(await fenced).toBeInstanceOf(Error);
  expect([a.hasControl(), b.hasControl()]).toEqual([false, true]);
  await f.runtime.input("window", "b", [{ type: "key", code: "ShiftLeft", down: true }]);
  await f.runtime.releaseControl("window", "b");
  expect([a.hasControl(), b.hasControl()]).toEqual([false, false]);
  expect(f.calls.at(-1)).toBe("releaseInput");
});

test("pausing a screen releases control", async () => {
  const f = setup();
  const viewer = await f.view();
  await f.runtime.takeControl("window", "viewer");
  expect(viewer.hasControl()).toBe(true);
  f.state("paused", "Unlock the host.");
  expect(viewer.hasControl()).toBe(false);
  await settle();
  expect(f.calls.at(-1)).toBe("releaseInput");
});

test("closing for a restart lets go of the helper and reconnects viewers to a new one", async () => {
  const f = setup();
  const viewer = await f.view();
  await f.runtime.dispose();
  // Its screen didn't end, so the viewer reconnects.
  expect(viewer.closed).toBe(true);
  expect(viewer.states.map((state) => state.status)).toEqual(["live"]);
  expect(f.calls).toEqual(["start", "close"]);
  const reconnected = await f.view();
  expect(reconnected.states.at(-1)?.status).toBe("live");
  expect(f.launches()).toBe(2);
  expect(f.calls).toEqual(["start", "close", "start"]);
});
