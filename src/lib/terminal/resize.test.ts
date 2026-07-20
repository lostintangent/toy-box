import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { TerminalResize } from "./resize";

test("fits on the leading frame and once more after a resize burst", async () => {
  const harness = createHarness();

  harness.triggerResize();
  expect(harness.pendingFrameCount()).toBe(1);
  harness.flushFrames();
  expect(harness.sizes).toEqual([{ cols: 100, rows: 30 }]);

  harness.triggerResize();
  harness.triggerResize();
  expect(harness.pendingFrameCount()).toBe(0);

  await Bun.sleep(100);
  expect(harness.pendingFrameCount()).toBe(1);
  harness.flushFrames();
  expect(harness.sizes).toEqual([
    { cols: 100, rows: 30 },
    { cols: 100, rows: 30 },
  ]);
});

test("defers trailing work while paused and fits once after resuming", async () => {
  const harness = createHarness();

  harness.triggerResize();
  harness.flushFrames();
  harness.triggerResize();
  harness.resize.setResizePaused(true);

  await Bun.sleep(100);
  expect(harness.pendingFrameCount()).toBe(0);
  expect(harness.sizes).toHaveLength(1);

  harness.resize.setResizePaused(false);
  expect(harness.pendingFrameCount()).toBe(1);
  harness.flushFrames();
  expect(harness.sizes).toHaveLength(2);
});

test("uninstall cancels pending frames and trailing work", async () => {
  const harness = createHarness();

  harness.triggerResize();
  expect(harness.pendingFrameCount()).toBe(1);
  harness.resize.uninstall();
  expect(harness.pendingFrameCount()).toBe(0);
  harness.flushFrames();
  expect(harness.sizes).toHaveLength(0);

  harness.install();
  harness.triggerResize();
  harness.flushFrames();
  harness.triggerResize();
  harness.resize.uninstall();

  await Bun.sleep(100);
  expect(harness.pendingFrameCount()).toBe(0);
  expect(harness.sizes).toHaveLength(1);
});

function createHarness() {
  const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const requestFrameDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const cancelFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const now = spyOn(performance, "now").mockImplementation(() => Date.now());
  const frames = new Map<number, FrameRequestCallback>();
  const observers: FakeResizeObserver[] = [];
  let nextFrameId = 1;

  class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }

    observe() {}
    disconnect() {}

    trigger() {
      this.callback([], this as unknown as ResizeObserver);
    }
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: FakeResizeObserver,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => frames.delete(id),
  });

  const sizes: Array<{ cols: number; rows: number }> = [];
  const xterm = { cols: 80, rows: 24 } as XTerm;
  const fitAddon = {
    fit() {},
    proposeDimensions: () => ({ cols: 100, rows: 30 }),
  } as unknown as FitAddon;
  const container = {
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  } as HTMLDivElement;
  const resize = new TerminalResize({
    onSizeChanged: (cols, rows) => sizes.push({ cols, rows }),
  });

  function install() {
    resize.install(container, xterm, fitAddon);
  }

  install();
  onTestFinished(() => {
    resize.dispose();
    now.mockRestore();
    restoreGlobal("ResizeObserver", resizeObserverDescriptor);
    restoreGlobal("requestAnimationFrame", requestFrameDescriptor);
    restoreGlobal("cancelAnimationFrame", cancelFrameDescriptor);
  });

  return {
    install,
    pendingFrameCount: () => frames.size,
    resize,
    sizes,
    triggerResize: () => observers.at(-1)?.trigger(),
    flushFrames: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(performance.now());
    },
  };
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
