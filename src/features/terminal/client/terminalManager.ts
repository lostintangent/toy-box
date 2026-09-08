/**
 * Orchestrates the client-side terminal by wiring together the connection,
 * resize, and buffer modules around a shared xterm.js instance. Exports the
 * singleton consumed by React components.
 */

import { Terminal as XTerm, type IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { getOrCreateClientId } from "@workspace/model/config/clientId";
import type { TerminalServerMessage } from "../model/protocol";
import { TerminalConnection } from "./connection";
import { TerminalResize, isValidSize } from "./resize";
import { TerminalBuffer } from "./buffer";
import { createTerminalTheme } from "./theme";

const TERMINAL_CONFIG = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
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
  #shell: string | undefined;

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

  attach(container: HTMLDivElement, handlers: TerminalHandlers) {
    const attachment = { container };
    this.#activeAttachment = attachment;

    if (this.#container && this.#container !== container) {
      this.#detachContainer();
    }

    this.#onReady = handlers.onReady ?? null;
    this.#onClose = handlers.onClose ?? null;
    this.#attachContainer(container);

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

    // Preserve the socket when React immediately remounts this shared terminal
    // into another container; a genuine detach still closes on the next task.
    setTimeout(() => {
      if (this.#activeAttachment === null) this.#closeConnection();
    });
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

  setShell(shell: string) {
    this.#shell = shell.trim() || undefined;
  }

  // Container lifecycle

  #attachContainer(container: HTMLDivElement) {
    this.#container = container;
    this.#ensureTerminal(container);
    this.#resize.install(container, this.#xterm!, this.#fitAddon!);
    this.#resize.fit();

    if (document?.fonts?.ready) {
      void document.fonts.ready.then(() => {
        this.#resize.fit();
      });
    }

    this.#xterm?.focus();
  }

  #detachContainer() {
    this.#resize.uninstall();
    this.#container = null;
  }

  #ensureTerminal(container: HTMLDivElement) {
    const view = container.ownerDocument.defaultView;
    const styles = view?.getComputedStyle(container);
    const theme = createTerminalTheme({
      isDark: view?.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
      background: styles?.backgroundColor ?? "",
    });

    if (!this.#xterm) {
      const xterm = new XTerm({ ...TERMINAL_CONFIG, theme });
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

    this.#xterm.options.theme = theme;

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
        this.#resetTerminal();
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
      this.#connection.sendMessage({
        type: "init",
        clientId: getOrCreateClientId(),
        cols,
        rows,
        shell: this.#shell,
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
