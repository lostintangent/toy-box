import { onTestFinished } from "bun:test";

/**
 * Stands in for the browser's WebSocket and timers until the test finishes. Sockets open,
 * speak and close only when the test says, and timers run only when it calls `runTimers`.
 */
export function installFakeSockets() {
  const sockets: FakeWebSocket[] = [];
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  let nextTimer = 0;

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readonly url: URL;
    readyState = FakeWebSocket.CONNECTING;
    binaryType = "blob";
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;

    constructor(url: URL) {
      this.url = new URL(url);
      sockets.push(this);
    }

    send(data: string | Uint8Array) {
      this.sent.push(typeof data === "string" ? JSON.parse(data) : new TextDecoder().decode(data));
    }

    close() {
      this.drop(1005);
    }

    accept() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }

    receive(data: string | ArrayBuffer) {
      this.onmessage?.({ data });
    }

    drop(code = 1006) {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }

  const globals = {
    WebSocket: FakeWebSocket,
    window: { location: { origin: "http://localhost:3100" } },
    setTimeout: (callback: () => void, delay: number) => {
      delays.push(delay);
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const originals = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  onTestFinished(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  return {
    sockets,
    /** Each retry's delay, in the order they were scheduled. */
    delays,
    socket: () => sockets.at(-1)!,
    runTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
  };
}
