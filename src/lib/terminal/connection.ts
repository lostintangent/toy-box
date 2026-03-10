/**
 * Manages the WebSocket connection to the terminal server, including
 * reconnection with exponential backoff and protocol message framing.
 */

import { DEFAULT_TERMINAL_WS_PORT } from "@/types";
import type { TerminalClientMessage, TerminalServerMessage } from "@/types";

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const WS_CLOSE_CODE_REPLACED = 4000;
const TEXT_ENCODER = new TextEncoder();

export type TerminalConnectionCallbacks = {
  isAttached: () => boolean;
  onOpen: () => void;
  onData: (data: Uint8Array) => void;
  onMessage: (message: TerminalServerMessage) => void;
  onClose: (code: number) => void;
};

function normalizePort(port: number): number {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT
    ? port
    : DEFAULT_TERMINAL_WS_PORT;
}

function detachHandlers(ws: WebSocket) {
  ws.onclose = null;
  ws.onerror = null;
  ws.onmessage = null;
  ws.onopen = null;
}

export class TerminalConnection {
  readonly #callbacks: TerminalConnectionCallbacks;
  #ws: WebSocket | null = null;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #wsPort = DEFAULT_TERMINAL_WS_PORT;

  public initSent = false;
  public lastSentSize: { cols: number; rows: number } | null = null;

  constructor(callbacks: TerminalConnectionCallbacks) {
    this.#callbacks = callbacks;
  }

  get isOpen(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  get port(): number {
    return this.#wsPort;
  }

  setPort(port: number): boolean {
    const nextPort = normalizePort(port);
    if (this.#wsPort === nextPort) return false;
    this.#wsPort = nextPort;
    return true;
  }

  connect() {
    if (typeof window === "undefined") return;
    if (!this.#callbacks.isAttached()) return;
    if (this.#ws && this.#ws.readyState !== WebSocket.CLOSED) return;

    if (this.#ws) {
      detachHandlers(this.#ws);
    }

    const wsUrl = new URL(window.location.origin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.port = String(this.#wsPort);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;

    ws.onopen = () => {
      this.#clearReconnectTimeout();
      this.#reconnectAttempts = 0;
      this.initSent = false;
      this.lastSentSize = null;
      this.#callbacks.onOpen();
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
      this.initSent = false;
      this.lastSentSize = null;

      this.#callbacks.onClose(event.code);
      this.#clearReconnectTimeout();

      if (!this.#callbacks.isAttached()) return;
      if (event.code === WS_CLOSE_CODE_REPLACED) return;

      this.#reconnectAttempts += 1;
      const delay = Math.min(1000 * 2 ** (this.#reconnectAttempts - 1), 10000);
      this.#reconnectTimeout = setTimeout(() => {
        this.connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose handles retries
    };
  }

  close() {
    if (this.#ws) {
      detachHandlers(this.#ws);
      this.#ws.close();
      this.#ws = null;
    }

    this.#clearReconnectTimeout();
    this.initSent = false;
    this.lastSentSize = null;
  }

  sendMessage(message: TerminalClientMessage) {
    if (!this.isOpen) return;
    this.#ws!.send(JSON.stringify(message));
  }

  sendData(data: string) {
    if (!this.isOpen) return;
    this.#ws!.send(TEXT_ENCODER.encode(data));
  }

  closeIfOpen() {
    if (this.#ws && this.#ws.readyState !== WebSocket.CLOSED) {
      this.close();
    }
  }

  dispose() {
    this.close();
  }

  #clearReconnectTimeout() {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }
  }
}
