/**
 * The terminal's WebSocket. While open, it stays connected, naming the tab and its size in
 * each socket's URL. Input and a resize sent while the socket is down wait for the next one.
 */

import type { z } from "zod";
import type {
  TerminalClientMessage,
  TerminalServerMessage,
  terminalAttachSchema,
} from "../model/protocol";
import { connectSocket } from "@/shared/socket";

const WS_CLOSE_CODE_REPLACED = 4000;
const MAX_PENDING_INPUT_CHARS = 32 * 1024;
const TEXT_ENCODER = new TextEncoder();

export type TerminalConnectionCallbacks = {
  /** The tab's ID and terminal size, named in each socket's URL. */
  params: () => z.infer<typeof terminalAttachSchema>;
  onData: (data: Uint8Array) => void;
  onMessage: (message: TerminalServerMessage) => void;
  onClose: () => void;
};

export class TerminalConnection {
  readonly #callbacks: TerminalConnectionCallbacks;
  #socket: ReturnType<typeof connectSocket> | undefined;
  #pendingInput = "";
  #pendingResize: TerminalClientMessage | undefined;

  constructor(callbacks: TerminalConnectionCallbacks) {
    this.#callbacks = callbacks;
  }

  /** Connects, and keeps reconnecting until closed. */
  open() {
    this.#socket ??= connectSocket("terminal", {
      params: this.#callbacks.params,
      onOpen: (socket) => {
        // The URL named the size as this socket was created, so a later resize waits for it.
        if (this.#pendingResize) socket.send(JSON.stringify(this.#pendingResize));
        if (this.#pendingInput) socket.send(TEXT_ENCODER.encode(this.#pendingInput));
        this.#pendingResize = undefined;
        this.#pendingInput = "";
      },
      onMessage: (data) => {
        if (typeof data !== "string") return this.#callbacks.onData(new Uint8Array(data));
        this.#callbacks.onMessage(JSON.parse(data) as TerminalServerMessage);
      },
      onClose: (event) => {
        this.#callbacks.onClose();
        // Another tab took this shell. Typing here takes it back.
        return event.code !== WS_CLOSE_CODE_REPLACED;
      },
    });
  }

  /** Sends input, or holds it and reconnects right away when the socket is down. */
  send(data: string) {
    if (this.#socket?.send(TEXT_ENCODER.encode(data))) return;
    this.#pendingInput = (this.#pendingInput + data).slice(-MAX_PENDING_INPUT_CHARS);
    this.#socket?.reconnect();
  }

  /** Sends the size, or holds it for the next socket when this one is down. */
  resize(cols: number, rows: number) {
    const message: TerminalClientMessage = { type: "resize", cols, rows };
    this.#pendingResize = this.#sendMessage(message) ? undefined : message;
  }

  /** Stops connecting and drops held input. The server keeps the shell for a while. */
  close() {
    this.#socket?.close();
    this.#socket = undefined;
    this.#pendingResize = undefined;
    this.#pendingInput = "";
  }

  /** Ends the shell, then closes. */
  end() {
    this.#sendMessage({ type: "close" });
    this.close();
  }

  #sendMessage(message: TerminalClientMessage) {
    return this.#socket?.send(JSON.stringify(message));
  }
}
