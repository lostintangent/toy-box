import { expect, onTestFinished, test } from "bun:test";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { SETTLE_MS, TerminalResize } from "./resize";

const PAST_SETTLE_MS = SETTLE_MS * 2;

test("fits once after a burst of container changes settles", async () => {
  const harness = createHarness();

  harness.triggerResize();
  harness.triggerResize();
  harness.triggerResize();
  expect(harness.sizes).toEqual([]);

  await Bun.sleep(PAST_SETTLE_MS);
  expect(harness.sizes).toEqual([{ cols: 100, rows: 30 }]);
});

test("keeps waiting while the container is still changing", async () => {
  const harness = createHarness();

  for (let i = 0; i < 4; i++) {
    harness.triggerResize();
    await Bun.sleep(SETTLE_MS / 2);
  }
  expect(harness.sizes).toEqual([]);

  await Bun.sleep(PAST_SETTLE_MS);
  expect(harness.sizes).toHaveLength(1);
});

test("fits straight away when asked directly", () => {
  const harness = createHarness();

  harness.resize.fit();
  expect(harness.sizes).toEqual([{ cols: 100, rows: 30 }]);
});

test("uninstall stops a settle that has not fired", async () => {
  const harness = createHarness();

  harness.triggerResize();
  harness.resize.uninstall();

  await Bun.sleep(PAST_SETTLE_MS);
  expect(harness.sizes).toEqual([]);
});

test("ignores a container with no area", async () => {
  const harness = createHarness({ width: 0, height: 0 });

  harness.triggerResize();
  await Bun.sleep(PAST_SETTLE_MS);
  expect(harness.sizes).toEqual([]);
});

function createHarness(size: { width: number; height: number } = { width: 800, height: 600 }) {
  const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const observers: FakeResizeObserver[] = [];

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

  const sizes: Array<{ cols: number; rows: number }> = [];
  const xterm = { cols: 80, rows: 24 } as XTerm;
  const fitAddon = {
    fit() {},
    proposeDimensions: () => ({ cols: 100, rows: 30 }),
  } as unknown as FitAddon;
  const container = { getBoundingClientRect: () => size } as HTMLDivElement;
  const resize = new TerminalResize({
    onSizeChanged: (cols, rows) => sizes.push({ cols, rows }),
  });

  resize.install(container, xterm, fitAddon);
  onTestFinished(() => {
    resize.dispose();
    if (resizeObserverDescriptor) {
      Object.defineProperty(globalThis, "ResizeObserver", resizeObserverDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "ResizeObserver");
    }
  });

  return {
    resize,
    sizes,
    triggerResize: () => observers.at(-1)?.trigger(),
  };
}
