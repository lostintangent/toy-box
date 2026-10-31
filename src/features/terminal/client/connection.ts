/**
 * The terminal's WebSocket. While open, it stays connected, reconnecting with
 * exponential backoff, and introduces the client with `init` each time the socket
 * opens. Input sent while the socket is down waits for the next one.
 */

import type { TerminalClientMessage, TerminalServerMessage } from "../model/protocol";
import { socketUrl } from "@/shared/socket";

const WS_CLOSE_CODE_REPLACED = 4000;
const MAX_PENDING_INPUT_CHARS = 32 * 1024;
const TEXT_ENCODER = new TextEncoder();

type TerminalInit = Extract<TerminalClientMessage, { type: "init" }>;

export type TerminalConnectionCallbacks = {
  /** Who the client is and its size, sent as `init` each time the socket opens. */
  hello: () => Omit<TerminalInit, "type">;
  onData: (data: Uint8Array) => void;
  onMessage: (message: TerminalServerMessage) => void;
  onClose: () => void;
};

function detachHandlers(ws: WebSocket) {
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
  ws.onopen = null;
}

export class TerminalConnection {
  readonly #callbacks: TerminalConnectionCallbacks;
  #ws: WebSocket | null = null;
  #wanted = false;
  #pendingInput = "";
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;

  constructor(callbacks: TerminalConnectionCallbacks) {
    this.#callbacks = callbacks;
  }

  /** Connects, and keeps reconnecting until closed. */
  open() {
    this.#wanted = true;
    this.#connect();
  }

  /** Sends input, or holds it and reconnects right away when the socket is down. */
  send(data: string) {
    if (this.#isOpen) {
      this.#ws!.send(TEXT_ENCODER.encode(data));
      return;
    }

    this.#pendingInput = (this.#pendingInput + data).slice(-MAX_PENDING_INPUT_CHARS);
    this.#connect();
  }

  resize(cols: number, rows: number) {
    this.#sendMessage({ type: "resize", cols, rows });
  }

  /** Stops connecting and drops held input. The server keeps the shell for a while. */
  close() {
    this.#wanted = false;
    this.#pendingInput = "";
    this.#clearReconnectTimeout();

    if (this.#ws) {
      detachHandlers(this.#ws);
      this.#ws.close();
      this.#ws = null;
    }
  }

  /** Ends the shell, then closes. */
  end() {
    this.#sendMessage({ type: "close" });
    this.close();
  }

  get #isOpen(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  #sendMessage(message: TerminalClientMessage) {
    if (this.#isOpen) this.#ws!.send(JSON.stringify(message));
  }

  #connect() {
    if (typeof window === "undefined") return;
    if (!this.#wanted) return;
    if (this.#ws && this.#ws.readyState !== WebSocket.CLOSED) return;

    if (this.#ws) {
      detachHandlers(this.#ws);
    }

    const ws = new WebSocket(socketUrl("terminal"));
    ws.binaryType = "arraybuffer";
    this.#ws = ws;

    ws.onopen = () => {
      this.#clearReconnectTimeout();
      this.#reconnectAttempts = 0;

      this.#sendMessage({ type: "init", ...this.#callbacks.hello() });
      if (this.#pendingInput) {
        ws.send(TEXT_ENCODER.encode(this.#pendingInput));
        this.#pendingInput = "";
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        let parsed: TerminalServerMessage;
        try {
          parsed = JSON.parse(event.data) as TerminalServerMessage;
        } catch {
          return;
        }
        this.#callbacks.onMessage(parsed);
      } else if (event.data instanceof ArrayBuffer) {
        this.#callbacks.onData(new Uint8Array(event.data));
      }
    };

    ws.onclose = (event) => {
      this.#callbacks.onClose();
      this.#clearReconnectTimeout();

      if (!this.#wanted) return;
      if (event.code === WS_CLOSE_CODE_REPLACED) return;

      this.#reconnectAttempts += 1;
      const delay = Math.min(1000 * 2 ** (this.#reconnectAttempts - 1), 10000);
      this.#reconnectTimeout = setTimeout(() => {
        this.#connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose handles retries
    };
  }

  #clearReconnectTimeout() {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }
  }
}
