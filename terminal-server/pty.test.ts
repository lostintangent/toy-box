import { describe, expect, onTestFinished, test } from "bun:test";
import { ALT_BUFFER_ENTER_SEQUENCE, ALT_BUFFER_EXIT_SEQUENCE } from "./ansi";
import { PTYManager } from "./pty";

import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./";

type TerminalControlMessage = { type: "ready"; resumed: boolean } | { type: "exit" };

type HarnessOptions = {
  orphanTimeoutMs?: number;
  idleTimeoutMs?: number;
  cleanupIntervalMs?: number;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const DEFAULT_CLIENT_ID = "client-1";
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_HARNESS_OPTIONS: Required<HarnessOptions> = {
  orphanTimeoutMs: 200,
  idleTimeoutMs: 5_000,
  cleanupIntervalMs: 500,
};

class FakeServerSocket {
  public data: WebSocketData;
  public readyState: number = WebSocket.OPEN;
  public controlMessages: TerminalControlMessage[] = [];
  public outputChunks: Uint8Array[] = [];
  public closeEvents: Array<{ code?: number; reason?: string }> = [];

  private bufferedAmount = 0;

  constructor(id: number) {
    this.data = { id };
  }

  send(payload: string | Uint8Array) {
    if (typeof payload === "string") {
      this.controlMessages.push(JSON.parse(payload) as TerminalControlMessage);
      return;
    }

    this.outputChunks.push(payload);
  }

  close(code?: number, reason?: string) {
    this.closeEvents.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
  }

  getBufferedAmount() {
    return this.bufferedAmount;
  }

  outputText() {
    return this.outputChunks.map((chunk) => textDecoder.decode(chunk)).join("");
  }

  hasExitMessage() {
    return this.controlMessages.some((message) => message.type === "exit");
  }
}

class FakePTYProcess {
  public resizes: Array<{ cols: number; rows: number }> = [];
  public writes: Array<string | Uint8Array> = [];
  public terminalClosed = false;
  public killed = false;
  public exited: Promise<number>;

  private resolveExited!: (code: number) => void;

  public terminal = {
    write: (data: string | Uint8Array) => {
      this.writes.push(data);
    },
    resize: (cols: number, rows: number) => {
      this.resizes.push({ cols, rows });
    },
    close: () => {
      this.terminalClosed = true;
    },
  };

  constructor(private readonly onData: (data: Uint8Array) => void) {
    this.exited = new Promise<number>((resolve) => {
      this.resolveExited = resolve;
    });
  }

  kill() {
    this.killed = true;
  }

  emitOutput(text: string) {
    this.onData(textEncoder.encode(text));
  }

  resolveExit(code = 0) {
    this.resolveExited(code);
  }
}

function toServerWebSocket(ws: FakeServerSocket): ServerWebSocket<WebSocketData> {
  return ws as unknown as ServerWebSocket<WebSocketData>;
}

function createHarness(options: HarnessOptions = {}) {
  const processes: FakePTYProcess[] = [];
  const spawnEnvs: Array<Record<string, string>> = [];
  const resolvedOptions = { ...DEFAULT_HARNESS_OPTIONS, ...options };
  const manager = new PTYManager({
    orphanTimeoutMs: resolvedOptions.orphanTimeoutMs,
    idleTimeoutMs: resolvedOptions.idleTimeoutMs,
    cleanupIntervalMs: resolvedOptions.cleanupIntervalMs,
    spawnProcess: (request) => {
      spawnEnvs.push(request.env);
      const proc = new FakePTYProcess(request.onData);
      processes.push(proc);
      return proc;
    },
  });

  onTestFinished(() => manager.dispose());

  return {
    manager,
    processes,
    spawnEnvs,
    createWs: (id: number) => new FakeServerSocket(id),
  };
}

function initClient(
  manager: PTYManager,
  ws: FakeServerSocket,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
) {
  manager.handleInit(toServerWebSocket(ws), DEFAULT_CLIENT_ID, cols, rows);
}

describe("PTYManager", () => {
  describe("common lifecycle scenarios", () => {
    test("creates a new PTY and resumes the same PTY on reconnect", async () => {
      const { manager, processes, createWs } = createHarness({ orphanTimeoutMs: 40 });
      const ws1 = createWs(1);
      initClient(manager, ws1);

      expect(processes).toHaveLength(1);
      expect(ws1.controlMessages[0]).toEqual({ type: "ready", resumed: false });

      processes[0].emitOutput("hello");
      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);

      const ws2 = createWs(2);
      initClient(manager, ws2, 100, 30);

      expect(processes).toHaveLength(1);
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: true });
      expect(ws2.outputText()).toBe("hello");
      expect(processes[0].resizes).toContainEqual({ cols: 100, rows: 30 });

      // Ensure reconnect cancels orphan teardown.
      await Bun.sleep(70);
      expect(processes[0].killed).toBe(false);
    }, 1000);

    test("replaces existing websocket when the same client reconnects", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      expect(processes).toHaveLength(1);

      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(processes).toHaveLength(1);
      expect(ws1.closeEvents).toContainEqual({ code: undefined, reason: "replaced" });
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: true });
    });

    test("keeps a disconnected PTY alive during orphan grace period", async () => {
      const { manager, processes, createWs } = createHarness({ orphanTimeoutMs: 60 });
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);
      await Bun.sleep(20);

      expect(processes[0].killed).toBe(false);
      expect(processes[0].terminalClosed).toBe(false);
    }, 1000);

    test("destroys orphaned PTY after orphan timeout", async () => {
      const { manager, processes, createWs } = createHarness({ orphanTimeoutMs: 30 });
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);
      await Bun.sleep(70);

      expect(processes[0].killed).toBe(true);

      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(processes).toHaveLength(2);
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: false });
    }, 1000);

    test("destroys PTY immediately on explicit close", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.handleClose(DEFAULT_CLIENT_ID);

      expect(processes[0].terminalClosed).toBe(true);
      expect(processes[0].killed).toBe(true);

      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(processes).toHaveLength(2);
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: false });
    });

    test("forwards binary input chunks directly to PTY writes", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      const input = textEncoder.encode("ls\n");
      manager.handleInput(DEFAULT_CLIENT_ID, input);

      expect(processes[0].writes).toHaveLength(1);
      expect(processes[0].writes[0]).toBe(input);
    });

    test("destroys idle PTY sessions and closes active sockets", async () => {
      const { manager, processes, createWs } = createHarness({
        orphanTimeoutMs: 500,
        idleTimeoutMs: 25,
        cleanupIntervalMs: 5,
      });
      const ws = createWs(1);
      initClient(manager, ws);

      await Bun.sleep(80);

      expect(processes[0].killed).toBe(true);
      expect(processes[0].terminalClosed).toBe(true);
      expect(
        ws.closeEvents.some((event) => event.code === undefined && event.reason === "idle"),
      ).toBe(true);
    }, 1000);
  });

  describe("alternate buffer replay scenarios", () => {
    test("replays only primary-buffer output after exiting alternate screen", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      processes[0].emitOutput("prompt$ ");
      processes[0].emitOutput(ALT_BUFFER_ENTER_SEQUENCE);
      processes[0].emitOutput("TUI FRAME");
      processes[0].emitOutput(ALT_BUFFER_EXIT_SEQUENCE);
      processes[0].emitOutput("\x1b[?2004h");
      processes[0].emitOutput("after-tui\n");

      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);
      const ws2 = createWs(2);
      initClient(manager, ws2);

      const replayed = ws2.outputText();
      expect(replayed).toContain("\x1b[?2004h");
      expect(replayed).toContain("prompt$ ");
      expect(replayed).toContain("after-tui\n");
      expect(replayed).not.toContain("TUI FRAME");
    });

    test("replays cursor-hide state when reconnecting in normal mode", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      processes[0].emitOutput("\x1b[?25l");
      processes[0].emitOutput("prompt$ ");
      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);

      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(ws2.outputText()).toBe("\x1b[?25lprompt$ ");
    });

    test("replays alternate-mode state and pokes redraw while alternate screen is active", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      processes[0].emitOutput("prompt$ ");
      processes[0].emitOutput(ALT_BUFFER_ENTER_SEQUENCE);
      processes[0].emitOutput("ACTIVE TUI FRAME");

      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);
      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(ws2.outputText()).toBe(ALT_BUFFER_ENTER_SEQUENCE);
      expect(processes[0].resizes).toContainEqual({ cols: 80, rows: 23 });
      expect(processes[0].resizes).toContainEqual({ cols: 80, rows: 24 });
    });

    test("restores mouse/private modes when reconnecting to an active alternate screen", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      processes[0].emitOutput(ALT_BUFFER_ENTER_SEQUENCE);
      processes[0].emitOutput("\x1b[?1000h");
      processes[0].emitOutput("\x1b[?1006h");
      processes[0].emitOutput("\x1b[?25l");
      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);

      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(ws2.outputText()).toBe("\x1b[?1000;1006;1049h\x1b[?25l");
    });

    test("does not poke redraw when reconnect already resized alternate screen", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      processes[0].emitOutput(ALT_BUFFER_ENTER_SEQUENCE);
      processes[0].emitOutput("ACTIVE TUI FRAME");
      manager.handleDisconnect(DEFAULT_CLIENT_ID, 1);

      const ws2 = createWs(2);
      initClient(manager, ws2, 100, 30);

      expect(ws2.outputText()).toBe(ALT_BUFFER_ENTER_SEQUENCE);
      expect(processes[0].resizes).toEqual([{ cols: 100, rows: 30 }]);
    });
  });

  describe("edge-case session ownership", () => {
    test("ignores stale process exits after a replacement session is created", async () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.handleClose(DEFAULT_CLIENT_ID);
      expect(processes).toHaveLength(1);

      const ws2 = createWs(2);
      initClient(manager, ws2);
      expect(processes).toHaveLength(2);

      processes[0].resolveExit();
      await Bun.sleep(0);

      expect(ws2.hasExitMessage()).toBe(false);

      processes[1].emitOutput("still-alive\n");
      expect(ws2.outputText()).toContain("still-alive\n");
    }, 1000);
  });
});
