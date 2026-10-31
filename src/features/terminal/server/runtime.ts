import { getProcessValue } from "@/shared/server/processState";
import { Debouncer } from "@tanstack/pacer/debouncer";
import type { Subprocess } from "bun";
import type { Peer } from "crossws";
import type { TerminalServerMessage } from "../model/protocol";
import { ScrollbackBuffer } from "./scrollback";

/** How long a PTY outlives its socket, so a refresh can resume the same shell. */
const ORPHAN_TIMEOUT_MS = 30_000;
/** Concurrent PTYs, which protects the single-user server process. */
const MAX_SESSIONS = 10;
/** Output a socket can have buffered before new output skips it. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
const CLOSE_CODE_REPLACED = 4000;

type TerminalPeer = Pick<Peer, "id" | "bufferedAmount" | "close" | "send" | "websocket">;

/** One tab's shell and the socket currently showing it. */
interface PTYSession {
  proc: PTYProcess;
  peer?: TerminalPeer;
  orphanClose: Debouncer<() => void>;
  scrollback: ScrollbackBuffer;
  cols: number;
  rows: number;
}

/**
 * The server's live terminals. Each tab's `clientId` owns at most one PTY, shown on one
 * socket at a time, and the PTY outlives that socket briefly so a refresh resumes it.
 */
export class TerminalRuntime {
  #sessions = new Map<string, PTYSession>();
  #orphanTimeoutMs: number;
  #spawnProcess: SpawnPTYProcess;

  constructor({
    orphanTimeoutMs = ORPHAN_TIMEOUT_MS,
    spawnProcess = defaultSpawnProcess,
  }: { orphanTimeoutMs?: number; spawnProcess?: SpawnPTYProcess } = {}) {
    this.#orphanTimeoutMs = orphanTimeoutMs;
    this.#spawnProcess = spawnProcess;
  }

  /** Shows a client's PTY on a socket, starting its shell or resuming it with a replay. */
  attach(peer: TerminalPeer, clientId: string, cols = 80, rows = 24, shell?: string) {
    const session = this.#sessions.get(clientId);
    if (!session) {
      if (this.#sessions.size >= MAX_SESSIONS) {
        peer.close(undefined, "max-sessions");
        return;
      }

      this.#sessions.set(clientId, this.#start(clientId, peer, cols, rows, shell));
      peer.send(JSON.stringify({ type: "ready", resumed: false } satisfies TerminalServerMessage));
      return;
    }

    // Install the new socket before closing the old one, so the old socket's
    // delayed close event cannot start the orphan timer.
    const replaced = session.peer;
    session.peer = peer;
    session.orphanClose.cancel();
    if (replaced && replaced.id !== peer.id) replaced.close(CLOSE_CODE_REPLACED, "replaced");

    const resized = session.cols !== cols || session.rows !== rows;
    this.resize(clientId, cols, rows);

    peer.send(JSON.stringify({ type: "ready", resumed: true } satisfies TerminalServerMessage));
    session.scrollback.replay((chunk) => peer.send(chunk));
    if (session.scrollback.isAlternateMode() && !resized) pokeRedraw(session);
  }

  input(clientId: string, data: string | Uint8Array) {
    this.#sessions.get(clientId)?.proc.terminal?.write(data);
  }

  resize(clientId: string, cols: number, rows: number) {
    const session = this.#sessions.get(clientId);
    if (!session?.proc.terminal || (session.cols === cols && session.rows === rows)) return;

    session.proc.terminal.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  /** Ends a client's shell and closes its socket. */
  close(clientId: string) {
    const session = this.#sessions.get(clientId);
    if (!session) return;

    this.#sessions.delete(clientId);
    session.orphanClose.cancel();
    session.peer?.close();

    try {
      session.proc.terminal?.close();
      session.proc.kill();
    } catch (error) {
      console.error("[terminal] Error killing PTY:", error);
    }
  }

  /** A socket went away. Unless a newer socket replaced it, its shell enters the orphan window. */
  detach(clientId: string, peerId: string) {
    const session = this.#sessions.get(clientId);
    if (!session || session.peer?.id !== peerId) return;

    session.peer = undefined;
    session.orphanClose.maybeExecute();
  }

  /** Ends every shell as the server shuts down. Their sockets close, so clients reconnect. */
  dispose() {
    for (const clientId of this.#sessions.keys()) this.close(clientId);
  }

  #start(
    clientId: string,
    peer: TerminalPeer,
    cols: number,
    rows: number,
    shell = process.env.SHELL || "bash",
  ): PTYSession {
    const scrollback = new ScrollbackBuffer();
    const proc = this.#spawnProcess({
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
        if (data.byteLength === 0) return;
        scrollback.add(data);
        send(session, data);
      },
    });

    const session: PTYSession = {
      proc,
      peer,
      orphanClose: new Debouncer(() => this.close(clientId), { wait: this.#orphanTimeoutMs }),
      scrollback,
      cols,
      rows,
    };

    proc.exited
      .then(() => {
        // A closed shell's exit must not end the client's replacement shell.
        if (this.#sessions.get(clientId) !== session) return;

        this.#sessions.delete(clientId);
        session.orphanClose.cancel();
        send(session, JSON.stringify({ type: "exit" } satisfies TerminalServerMessage));
      })
      .catch((error) => {
        console.error("[terminal] PTY exited with error:", error);
      });

    return session;
  }
}

/** Sends to the session's socket, skipping one that has fallen too far behind. */
function send(session: PTYSession, payload: string | Uint8Array) {
  const { peer } = session;
  try {
    if (peer?.websocket.readyState === WebSocket.OPEN && peer.bufferedAmount < MAX_BUFFERED_BYTES) {
      peer.send(payload);
    }
  } catch (error) {
    console.error("[terminal] Error sending to socket:", error);
  }
}

// A client reattaching mid-TUI (alternate screen active) receives only the mode state,
// since there is no captured frame to replay. Nudging the row count and restoring it
// fires SIGWINCH inside the PTY, so full-screen apps (vim, htop, less) repaint against
// the new socket, and the size ends up unchanged from the client's perspective.
function pokeRedraw({ proc, cols, rows }: PTYSession) {
  if (!proc.terminal) return;
  proc.terminal.resize(cols, rows > 1 ? rows - 1 : rows + 1);
  proc.terminal.resize(cols, rows);
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

export const terminalRuntime = getProcessValue("terminal-runtime", () => new TerminalRuntime());
