import { describe, expect, onTestFinished, spyOn, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { emulatorOptions, loadUnicode11 } from "../model/emulator";
import type { TerminalServerMessage } from "../model/protocol";
import { TerminalRuntime } from "./runtime";

type TerminalPeer = Parameters<TerminalRuntime["attach"]>[0];

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const DEFAULT_CLIENT_ID = "client-1";
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

class FakeServerSocket {
  public readonly id: string;
  public readonly websocket: { readyState: number } = { readyState: WebSocket.OPEN };
  public controlMessages: TerminalServerMessage[] = [];
  public outputChunks: Uint8Array[] = [];
  public closeEvents: Array<{ code?: number; reason?: string }> = [];

  public bufferedAmount = 0;

  constructor(id: number) {
    this.id = String(id);
  }

  send(payload: string | Uint8Array) {
    if (typeof payload === "string") {
      this.controlMessages.push(JSON.parse(payload) as TerminalServerMessage);
      return;
    }

    this.outputChunks.push(payload);
  }

  close(code?: number, reason?: string) {
    this.closeEvents.push({ code, reason });
    this.websocket.readyState = WebSocket.CLOSED;
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
  /** A shell that outlives being closed. */
  public lingers = false;
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
    if (!this.lingers) this.resolveExit();
  }

  emitOutput(text: string) {
    this.onData(textEncoder.encode(text));
  }

  resolveExit(code = 0) {
    this.resolveExited(code);
  }
}

function toTerminalPeer(ws: FakeServerSocket): TerminalPeer {
  return ws as unknown as TerminalPeer;
}

function createHarness({ orphanTimeoutMs = 200 } = {}) {
  const processes: FakePTYProcess[] = [];
  const spawnEnvs: Array<Record<string, string>> = [];
  const manager = new TerminalRuntime({
    orphanTimeoutMs,
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

/** What a browser terminal shows after writing `output`, including the state it reports. */
function screenOf(output: string, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
  const terminal = new Terminal({ ...emulatorOptions, cols, rows });
  loadUnicode11(terminal);
  let reports = "";
  terminal.onData((report) => (reports += report));
  terminal.write(output);

  return new Promise((resolve) => {
    terminal.write("\x1b[?25$p\x1b[?1006$p\x1bP$qr\x1b\\", () => {
      const { active } = terminal.buffer;
      const lines = Array.from({ length: active.length }, (_, y) => {
        const line = active.getLine(y)!;
        return { text: line.translateToString(true), color: line.getCell(0)?.getFgColor() };
      });
      resolve({
        buffer: active.type,
        lines,
        cursor: [active.cursorX, active.cursorY],
        modes: terminal.modes,
        reports,
      });
    });
  });
}

function parseQueuedOutput() {
  // xterm schedules its write buffer on the zero-delay timer queue.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function initClient(
  manager: TerminalRuntime,
  ws: FakeServerSocket,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
) {
  manager.attach(toTerminalPeer(ws), DEFAULT_CLIENT_ID, cols, rows);
}

describe("TerminalRuntime", () => {
  describe("common lifecycle scenarios", () => {
    test("creates a new PTY and resumes the same PTY on reconnect", async () => {
      const { manager, processes, createWs } = createHarness({ orphanTimeoutMs: 40 });
      const ws1 = createWs(1);
      initClient(manager, ws1);

      expect(processes).toHaveLength(1);
      expect(ws1.controlMessages[0]).toEqual({ type: "ready", resumed: false });

      processes[0].emitOutput("hello");
      await parseQueuedOutput();
      manager.detach(DEFAULT_CLIENT_ID, "1");
      processes[0].emitOutput(" world");

      const ws2 = createWs(2);
      initClient(manager, ws2, 100, 30);

      expect(processes).toHaveLength(1);
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: true });
      expect(ws2.outputText()).toBe("hello");
      expect(processes[0].resizes).toContainEqual({ cols: 100, rows: 30 });

      await parseQueuedOutput();
      expect(ws2.outputText()).toBe("hello world");

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
      expect(ws1.closeEvents).toContainEqual({ code: 4000, reason: "replaced" });
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: true });
    });

    test("keeps a disconnected PTY alive during orphan grace period", async () => {
      const { manager, processes, createWs } = createHarness({ orphanTimeoutMs: 60 });
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.detach(DEFAULT_CLIENT_ID, "1");
      await Bun.sleep(20);

      expect(processes[0].killed).toBe(false);
      expect(processes[0].terminalClosed).toBe(false);
    }, 1000);

    test("destroys orphaned PTY after orphan timeout", async () => {
      const { manager, processes, createWs } = createHarness({ orphanTimeoutMs: 30 });
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.detach(DEFAULT_CLIENT_ID, "1");
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

      manager.close(DEFAULT_CLIENT_ID);

      expect(processes[0].terminalClosed).toBe(true);
      expect(processes[0].killed).toBe(true);

      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(processes).toHaveLength(2);
      expect(ws2.controlMessages[0]).toEqual({ type: "ready", resumed: false });
    });

    test("shuts down once every shell has exited", async () => {
      const { manager, processes, createWs } = createHarness();
      manager.attach(toTerminalPeer(createWs(1)), "client-1");
      manager.attach(toTerminalPeer(createWs(2)), "client-2");
      processes[1].lingers = true;

      let disposed = false;
      void manager.dispose().then(() => {
        disposed = true;
      });
      await Bun.sleep(0);
      expect(disposed).toBe(false);

      processes[1].resolveExit();
      await Bun.sleep(0);
      expect(disposed).toBe(true);
    });

    test("forwards binary input chunks directly to PTY writes", () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      const input = textEncoder.encode("ls\n");
      manager.input(DEFAULT_CLIENT_ID, input);

      expect(processes[0].writes).toHaveLength(1);
      expect(processes[0].writes[0]).toBe(input);
    });
  });

  describe("replay scenarios", () => {
    test("replays a full-screen app's screen and the modes it set", async () => {
      const { manager, processes, createWs } = createHarness();
      initClient(manager, createWs(1));
      const output =
        "prompt$ vim 你好🙂\r\n" +
        // An alternate screen, hidden cursor, SGR mouse reports, bracketed paste and a scroll region
        "\x1b[?1049h\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25l\x1b[2;20r" +
        "\x1b[H\x1b[2J~\r\n~ text\x1b[?6h\x1b[5;3H";
      processes[0].emitOutput(output);
      await parseQueuedOutput();

      manager.detach(DEFAULT_CLIENT_ID, "1");
      const ws2 = createWs(2);
      initClient(manager, ws2);

      expect(await screenOf(ws2.outputText())).toEqual(await screenOf(output));
      // Quitting the app returns to the normal screen as it was.
      const quit = "\x1b[?6l\x1b[r\x1b[?25h\x1b[?1049l";
      expect(await screenOf(ws2.outputText() + quit)).toEqual(await screenOf(output + quit));
    });

    test("a resume mid-CSI does not change the buffer's parsed screen", async () => {
      const { manager, processes, createWs } = createHarness();
      initClient(manager, createWs(1));
      const start = "one\r\n\x1b[3";
      const end = "1mRED\x1b[0m\r\n";
      processes[0].emitOutput(start);
      await parseQueuedOutput();
      initClient(manager, createWs(2));
      processes[0].emitOutput(end);
      await parseQueuedOutput();
      const ws3 = createWs(3);
      initClient(manager, ws3);

      expect(await screenOf(ws3.outputText())).toEqual(await screenOf(start + end));
    });
  });

  describe("edge-case session ownership", () => {
    test("sends the last queued output before the shell's exit", async () => {
      const { manager, processes, createWs } = createHarness();
      const ws = createWs(1);
      initClient(manager, ws);
      const send = spyOn(ws, "send");

      processes[0].emitOutput("last output");
      processes[0].resolveExit();
      await processes[0].exited;
      await parseQueuedOutput();

      expect(send.mock.calls).toEqual([
        [textEncoder.encode("last output")],
        [JSON.stringify({ type: "exit" })],
      ]);
    });

    test("ignores stale process exits after a replacement session is created", async () => {
      const { manager, processes, createWs } = createHarness();
      const ws1 = createWs(1);
      initClient(manager, ws1);

      manager.close(DEFAULT_CLIENT_ID);
      expect(processes).toHaveLength(1);

      const ws2 = createWs(2);
      initClient(manager, ws2);
      expect(processes).toHaveLength(2);

      processes[0].resolveExit();
      await processes[0].exited;
      await parseQueuedOutput();

      expect(ws2.hasExitMessage()).toBe(false);

      processes[1].emitOutput("still-alive\n");
      await parseQueuedOutput();
      expect(ws2.outputText()).toContain("still-alive\n");
    }, 1000);

    test("keeps a closed shell's trailing output out of its replacement", async () => {
      const { manager, processes, createWs } = createHarness();
      initClient(manager, createWs(1));
      manager.close(DEFAULT_CLIENT_ID);

      const ws2 = createWs(2);
      initClient(manager, ws2);
      processes[0].emitOutput("old-shell\n");
      await parseQueuedOutput();

      expect(ws2.outputText()).toBe("");
    });
  });
});
