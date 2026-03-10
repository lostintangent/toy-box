import { ScrollbackBuffer } from "./scrollback";

import type { ServerWebSocket, Subprocess } from "bun";
import type { TerminalServerMessage } from "../src/types";
import type { WebSocketData } from "./";

const ORPHAN_TIMEOUT_MS = 30_000; // 30 seconds
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_SESSIONS = 10;

const MAX_WS_BUFFERED_BYTES = 1024 * 1024;

interface PTYSession {
  proc: PTYProcess;
  connections: Map<number, ServerWebSocket<WebSocketData>>;
  lastActivity: number;
  orphanTimeout?: ReturnType<typeof setTimeout>;
  scrollback: ScrollbackBuffer;
  cols: number;
  rows: number;
}

type PTYSessionCloseReason = "idle" | "orphaned" | "client";

interface PTYManagerOptions {
  orphanTimeoutMs?: number;
  idleTimeoutMs?: number;
  cleanupIntervalMs?: number;
  maxSessions?: number;
  spawnProcess?: SpawnPTYProcess;
}

export class PTYManager {
  private sessions = new Map<string, PTYSession>();

  private readonly idleTimeoutMs: number;
  private readonly orphanTimeoutMs: number;
  private readonly maxSessions: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  private readonly spawnProcess: SpawnPTYProcess;

  constructor({
    orphanTimeoutMs = ORPHAN_TIMEOUT_MS,
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    cleanupIntervalMs = CLEANUP_INTERVAL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    spawnProcess = defaultSpawnProcess,
  }: PTYManagerOptions = {}) {
    this.orphanTimeoutMs = orphanTimeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxSessions = maxSessions;

    this.spawnProcess = spawnProcess;
    this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), cleanupIntervalMs);
  }

  // Public API for handling WebSocket events from the server

  public handleInit(
    ws: ServerWebSocket<WebSocketData>,
    clientId: string,
    cols = 80,
    rows = 24,
    shell?: string,
  ) {
    const session = this.sessions.get(clientId);
    const wsId = ws.data.id;

    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        ws.close(undefined, "max-sessions");
        return;
      }

      const newSession = this.createSession(clientId, wsId, ws, cols, rows, shell);

      this.sessions.set(clientId, newSession);
      ws.send(JSON.stringify({ type: "ready", resumed: false }));
    } else {
      let resizedOnAttach = false;
      const replacedConnections: Array<ServerWebSocket<WebSocketData>> = [];
      for (const [existingId, existingWs] of session.connections) {
        if (existingId !== wsId) {
          replacedConnections.push(existingWs);
        }
      }

      // Install the new socket before closing old sockets so delayed close events
      // cannot temporarily leave the session with zero connections.
      session.connections.clear();
      session.connections.set(wsId, ws);

      this.clearOrphanTimeout(session);
      this.markSessionActive(session);

      for (const existingWs of replacedConnections) {
        existingWs.close(undefined, "replaced");
      }

      // Resize existing PTY to match new client dimensions
      if (session.proc.terminal && (session.cols !== cols || session.rows !== rows)) {
        session.proc.terminal.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;

        resizedOnAttach = true;
      }

      // Send ready message first
      ws.send(JSON.stringify({ type: "ready", resumed: true }));

      if (session.scrollback.isAlternateMode()) {
        session.scrollback.replayModeState((chunk) => ws.send(chunk));

        if (!resizedOnAttach) {
          this.pokeAlternateScreenRefresh(session);
        }
      } else {
        // Replay normal-mode private state and scrollback output.
        session.scrollback.replay((chunk) => ws.send(chunk));
      }
    }
  }

  public handleInput(clientId: string, data: string | Uint8Array) {
    const session = this.sessions.get(clientId);
    if (!session?.proc.terminal) return;

    session.proc.terminal.write(data);
    this.markSessionActive(session);
  }

  public handleResize(clientId: string, cols: number, rows: number) {
    const session = this.sessions.get(clientId);
    if (!session?.proc.terminal) return;

    if (session.cols === cols && session.rows === rows) return;

    session.proc.terminal.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    this.markSessionActive(session);
  }

  public handleClose(clientId: string) {
    this.closePTY(clientId, "client");
  }

  public handleDisconnect(clientId: string, wsId: number) {
    const session = this.sessions.get(clientId);
    if (!session) return;

    session.connections.delete(wsId);

    // If this was the last connection, start the orphan timeout to
    // eventually close the PTY if no new connections are made.
    if (session.connections.size === 0) {
      this.clearOrphanTimeout(session);

      session.orphanTimeout = setTimeout(() => {
        this.closePTY(clientId, "orphaned");
      }, this.orphanTimeoutMs);
    }
  }

  // Internal helper methods

  private createSession(
    clientId: string,
    wsId: number,
    ws: ServerWebSocket<WebSocketData>,
    cols: number,
    rows: number,
    shell: string = process.env.SHELL || "bash",
  ): PTYSession {
    const scrollback = new ScrollbackBuffer();

    const proc = this.spawnProcess({
      shell,
      cwd: process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      cols,
      rows,
      onData: (data) => {
        const activeSession = this.sessions.get(clientId);
        if (activeSession) {
          this.markSessionActive(activeSession);
        }

        if (data.byteLength === 0) return;

        // Add the output to the scrollback (for replay)
        // and then broadcast it to all connected clients.
        scrollback.add(data);
        this.broadcastOutput(clientId, data);
      },
    });

    const session: PTYSession = {
      proc,
      connections: new Map([[wsId, ws]]),
      lastActivity: Date.now(),
      scrollback,
      cols,
      rows,
    };

    proc.exited
      .then(() => {
        // Ignore stale exit events from processes that are no longer active for this client.
        const activeSession = this.sessions.get(clientId);
        if (activeSession !== session) return;

        // Notify connected clients of exit and clean up session.
        this.broadcastControl(clientId, { type: "exit" });

        activeSession.connections.clear();
        this.sessions.delete(clientId);
      })
      .catch((error) => {
        console.error("[terminal] PTY exited with error:", error);
      });

    return session;
  }

  private broadcast(clientId: string, payload: string | Uint8Array) {
    const session = this.sessions.get(clientId);
    if (!session) return;

    for (const ws of session.connections.values()) {
      try {
        // Check backpressure - skip if client buffer is too large
        if (ws.readyState === WebSocket.OPEN && ws.getBufferedAmount() < MAX_WS_BUFFERED_BYTES) {
          ws.send(payload);
        }
      } catch (err) {
        console.error(`[terminal] Error broadcasting to connection:`, err);
      }
    }
  }

  private broadcastControl(clientId: string, message: TerminalServerMessage) {
    this.broadcast(clientId, JSON.stringify(message));
  }

  private broadcastOutput(clientId: string, chunk: Uint8Array) {
    this.broadcast(clientId, chunk);
  }

  private cleanupIdleSessions() {
    const now = Date.now();
    for (const [clientId, session] of this.sessions) {
      if (now - session.lastActivity > this.idleTimeoutMs) {
        this.closePTY(clientId, "idle");
      }
    }
  }

  private clearOrphanTimeout(session: PTYSession) {
    if (!session.orphanTimeout) return;

    clearTimeout(session.orphanTimeout);
    session.orphanTimeout = undefined;
  }

  private markSessionActive(session: PTYSession) {
    session.lastActivity = Date.now();
  }

  private pokeAlternateScreenRefresh(session: PTYSession) {
    if (!session.proc.terminal) return;
    const currentRows = session.rows;
    const pokeRows = currentRows > 1 ? currentRows - 1 : currentRows + 1;
    if (pokeRows === currentRows) return;

    session.proc.terminal.resize(session.cols, pokeRows);
    session.proc.terminal.resize(session.cols, currentRows);
  }

  private closePTY(clientId: string, reason: PTYSessionCloseReason) {
    const session = this.sessions.get(clientId);
    if (!session) return;

    this.clearOrphanTimeout(session);

    // Notify connected clients when the server initiates the close
    if (reason === "idle") {
      for (const ws of session.connections.values()) {
        ws.close(undefined, reason);
      }
    }

    try {
      session.proc.terminal?.close();
      session.proc.kill();
    } catch (err) {
      console.error(`[terminal] Error killing PTY:`, err);
    }

    session.connections.clear();
    this.sessions.delete(clientId);
  }

  public dispose() {
    clearInterval(this.cleanupInterval);

    for (const [clientId] of this.sessions) {
      this.closePTY(clientId, "client");
    }
  }
}

// Test abstractions that allow injecting a fake PTY process for testing

type PTYProcess = Pick<Subprocess, "kill" | "exited"> & {
  terminal?: {
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    close(): void;
  };
};

interface PTYSpawnRequest {
  shell: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void;
}

type SpawnPTYProcess = (request: PTYSpawnRequest) => PTYProcess;

function defaultSpawnProcess({ shell, cwd, env, cols, rows, onData }: PTYSpawnRequest): PTYProcess {
  return Bun.spawn([shell], {
    cwd,
    env,
    terminal: {
      cols,
      rows,
      name: "xterm-256color",
      data: (_, data) => onData(data),
    },
  });
}
