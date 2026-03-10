/**
 * Orchestrates the client-side terminal by wiring together the connection,
 * resize, and buffer modules around a shared xterm.js instance. Exports the
 * singleton consumed by React components.
 */

import { type ITheme, Terminal as XTerm, type IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { getOrCreateClientId } from "@/lib/config/clientId";
import { getStoredTerminalShell } from "@/lib/terminal/settings";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";
import type { TerminalServerMessage } from "@/types";
import { TerminalConnection } from "./connection";
import { TerminalResize, isValidSize } from "./resize";
import { TerminalBuffer } from "./buffer";

const DARK_THEME: ITheme = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#000000",
  cursorAccent: "#ffffff",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#cd3131",
  green: "#107c10",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function getTerminalTheme(): ITheme {
  if (typeof window === "undefined") return DARK_THEME;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK_THEME : LIGHT_THEME;
}

const TERMINAL_CONFIG = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: getTerminalTheme(),
  scrollback: 1000,
  allowProposedApi: true,
} as const;

export type TerminalHandlers = {
  onReady?: (isReady: boolean) => void;
  onClose?: () => void;
};

class TerminalManager {
  #xterm: XTerm | null = null;
  #fitAddon: FitAddon | null = null;
  #dataDisposable: IDisposable | null = null;

  #container: HTMLDivElement | null = null;
  #activeAttachment: { container: HTMLDivElement } | null = null;

  #size: { cols: number; rows: number } | null = null;
  #isReady = false;
  #onReady: ((isReady: boolean) => void) | null = null;
  #onClose: (() => void) | null = null;

  readonly #connection: TerminalConnection;
  readonly #resize: TerminalResize;
  readonly #buffer: TerminalBuffer;

  constructor() {
    this.#buffer = new TerminalBuffer({
      isReadyToSend: () => this.#connection.isOpen && this.#connection.initSent,
      writeToPty: (data) => this.#connection.sendData(data),
      writeToXterm: (data) => this.#xterm?.write(data),
      onFirstOutput: () => this.#markReady(),
      ensureConnection: () => this.#connection.connect(),
    });

    this.#connection = new TerminalConnection({
      isAttached: () => this.#activeAttachment !== null,
      onOpen: () => this.#handleConnectionOpen(),
      onData: (data) => this.#buffer.bufferOutput(data),
      onMessage: (msg) => this.#handleServerMessage(msg),
      onClose: () => this.#handleConnectionClose(),
    });

    this.#resize = new TerminalResize({
      onSizeChanged: (cols, rows) => this.#reportSize(cols, rows),
    });
  }

  attach(container: HTMLDivElement, handlers: TerminalHandlers, wsPort = DEFAULT_TERMINAL_WS_PORT) {
    const attachment = { container };
    this.#activeAttachment = attachment;

    const portChanged = this.#connection.setPort(wsPort);

    if (this.#container && this.#container !== container) {
      this.#detachContainer();
    }

    this.#onReady = handlers.onReady ?? null;
    this.#onClose = handlers.onClose ?? null;
    this.#attachContainer(container);

    if (portChanged) {
      this.#connection.closeIfOpen();
    }

    this.#connection.connect();
    this.#onReady?.(this.#isReady);

    return () => {
      if (this.#activeAttachment !== attachment) return;
      this.detach(attachment.container);
    };
  }

  detach(container?: HTMLDivElement) {
    if (container && this.#container !== container) return;

    this.#activeAttachment = null;
    this.#onReady = null;
    this.#onClose = null;

    if (this.#container) {
      this.#detachContainer();
    }

    this.#closeConnection();
  }

  close() {
    if (this.#connection.isOpen) {
      this.#connection.sendMessage({ type: "close" });
    }

    this.#closeConnection();
    this.#resetTerminal();
  }

  sendInput(data: string) {
    if (!data) return;
    this.#buffer.bufferInput(data);
    this.#xterm?.focus();
  }

  setResizePaused(paused: boolean) {
    this.#resize.setResizePaused(paused);
  }

  // Container lifecycle

  #attachContainer(container: HTMLDivElement) {
    this.#container = container;
    this.#ensureTerminal(container);
    this.#resize.install(container, this.#xterm!, this.#fitAddon!);
    this.#resize.scheduleFit();

    if (document?.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.#resize.scheduleFit();
      });
    }

    this.#xterm?.focus();
  }

  #detachContainer() {
    this.#resize.uninstall();
    this.#container = null;
  }

  #ensureTerminal(container: HTMLDivElement) {
    if (!this.#xterm) {
      const xterm = new XTerm(TERMINAL_CONFIG);
      const fitAddon = new FitAddon();
      const unicodeAddon = new Unicode11Addon();

      xterm.loadAddon(fitAddon);
      xterm.loadAddon(unicodeAddon);
      xterm.unicode.activeVersion = "11";
      xterm.open(container);

      try {
        xterm.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available — fall back to default canvas renderer
      }

      this.#xterm = xterm;
      this.#fitAddon = fitAddon;

      if (!this.#dataDisposable) {
        this.#dataDisposable = xterm.onData((data) => {
          this.#buffer.bufferInput(data);
        });
      }
      return;
    }

    if (this.#xterm.element && this.#xterm.element.parentElement !== container) {
      container.innerHTML = "";
      container.appendChild(this.#xterm.element);
    }
  }

  // Connection event handlers

  #handleConnectionOpen() {
    if (this.#size) {
      this.#reportSize(this.#size.cols, this.#size.rows);
    } else if (this.#xterm) {
      this.#reportSize(Math.max(this.#xterm.cols, 80), Math.max(this.#xterm.rows, 24));
    }
  }

  #handleServerMessage(msg: TerminalServerMessage) {
    if (!this.#xterm) return;

    switch (msg.type) {
      case "ready":
        if (msg.resumed) {
          this.#buffer.resetOutputBuffer();
          this.#xterm.reset();
          this.#isReady = false;
        }
        this.#reportSize(this.#xterm.cols, this.#xterm.rows);
        break;

      case "exit":
        this.#closeConnection();
        this.#onClose?.();
        break;
    }
  }

  #handleConnectionClose() {
    this.#isReady = false;
    this.#onReady?.(false);
  }

  // Size reporting (cross-cutting: connection + buffer + local state)

  #reportSize(cols: number, rows: number) {
    if (!isValidSize(cols, rows)) return;
    this.#size = { cols, rows };

    if (!this.#connection.isOpen) return;

    if (!this.#connection.initSent) {
      const shell = getStoredTerminalShell();
      this.#connection.sendMessage({
        type: "init",
        clientId: getOrCreateClientId(),
        cols,
        rows,
        shell: shell ?? undefined,
      });
      this.#connection.initSent = true;
      this.#connection.lastSentSize = { cols, rows };
      this.#buffer.flushPendingInput();
      return;
    }

    const lastSent = this.#connection.lastSentSize;
    if (!lastSent || lastSent.cols !== cols || lastSent.rows !== rows) {
      this.#connection.sendMessage({ type: "resize", cols, rows });
      this.#connection.lastSentSize = { cols, rows };
    }
  }

  // Internal helpers

  #closeConnection() {
    this.#buffer.flushOutputBuffer();
    this.#buffer.resetOutputBuffer();
    this.#buffer.clearPendingInput();
    this.#connection.close();
  }

  #resetTerminal() {
    if (this.#xterm) {
      this.#xterm.reset();
    }
    this.#isReady = false;
    this.#onReady?.(this.#isReady);
  }

  #markReady() {
    if (this.#isReady) return;
    this.#isReady = true;
    this.#onReady?.(true);
  }
}

export const terminalManager = new TerminalManager();
