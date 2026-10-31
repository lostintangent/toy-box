import { expect, onTestFinished, test } from "bun:test";
import { TerminalConnection } from "./connection";

test("introduces the client with its current size and shell each time the socket opens", () => {
  const harness = createHarness();
  harness.connection.open();
  harness.socket().accept();

  Object.assign(harness.size, { cols: 100, rows: 30 });
  harness.socket().drop();
  harness.runTimers();
  harness.socket().accept();

  expect(harness.sockets.map((socket) => socket.sent[0])).toEqual([
    { type: "init", clientId: "tab-1", cols: 80, rows: 24, shell: "zsh" },
    { type: "init", clientId: "tab-1", cols: 100, rows: 30, shell: "zsh" },
  ]);
});

test("sends input typed before the socket opens right after init", () => {
  const harness = createHarness();
  harness.connection.open();
  harness.connection.send("l");
  harness.connection.send("s\r");

  harness.socket().accept();

  expect(harness.socket().sent).toEqual([expect.objectContaining({ type: "init" }), "ls\r"]);
});

test("reconnects as soon as input arrives while the socket is down", () => {
  const harness = createHarness();
  harness.connection.open();
  harness.socket().accept();
  harness.socket().drop();

  harness.connection.send("x");
  expect(harness.sockets).toHaveLength(2);

  harness.socket().accept();
  expect(harness.socket().sent).toEqual([expect.objectContaining({ type: "init" }), "x"]);
});

test("stays closed after another tab replaces its socket", () => {
  const harness = createHarness();
  harness.connection.open();
  harness.socket().accept();

  harness.socket().drop(4000);
  harness.runTimers();

  expect(harness.sockets).toHaveLength(1);
});

test("drops held input when closed", () => {
  const harness = createHarness();
  harness.connection.open();
  harness.connection.send("make\r");
  harness.connection.close();

  harness.connection.open();
  harness.socket().accept();

  expect(harness.socket().sent).toEqual([expect.objectContaining({ type: "init" })]);
});

function createHarness() {
  const sockets: FakeWebSocket[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    binaryType = "blob";
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onmessage: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
      sockets.push(this);
    }

    send(data: string | Uint8Array) {
      this.sent.push(typeof data === "string" ? JSON.parse(data) : new TextDecoder().decode(data));
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }

    accept() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }

    drop(code = 1006) {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }

  const globals = {
    WebSocket: FakeWebSocket,
    window: { location: { origin: "http://localhost" } },
    setTimeout: (callback: () => void) => {
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

  const size = { cols: 80, rows: 24 };
  return {
    sockets,
    size,
    socket: () => sockets.at(-1)!,
    runTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
    connection: new TerminalConnection({
      hello: () => ({ clientId: "tab-1", ...size, shell: "zsh" }),
      onData: () => {},
      onMessage: () => {},
      onClose: () => {},
    }),
  };
}
