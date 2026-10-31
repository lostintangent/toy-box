/**
 * Owns the client-side terminal: one xterm.js instance shown in whichever
 * container is attached, its connection to the server, and its fit to that
 * container. Exports the singleton consumed by React components.
 */

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { getOrCreateClientId } from "@workspace/model/config/clientId";
import type { TerminalServerMessage } from "../model/protocol";
import { TerminalConnection } from "./connection";
import { TerminalResize } from "./resize";
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
  #attachment: (TerminalHandlers & { container: HTMLDivElement }) | null = null;

  /** Whether the terminal has shown output since it last reset or lost its socket. */
  #isReady = false;
  #shell: string | undefined;

  readonly #connection = new TerminalConnection({
    hello: () => ({
      clientId: getOrCreateClientId(),
      cols: this.#xterm?.cols,
      rows: this.#xterm?.rows,
      shell: this.#shell,
    }),
    onData: (data) => {
      this.#xterm?.write(data);
      if (!this.#isReady) this.#setReady(true);
    },
    onMessage: (message) => this.#handleServerMessage(message),
    onClose: () => this.#setReady(false),
  });

  readonly #resize = new TerminalResize({
    onSizeChanged: (cols, rows) => this.#connection.resize(cols, rows),
  });

  attach(container: HTMLDivElement, handlers: TerminalHandlers) {
    const attachment = { ...handlers, container };
    this.#attachment = attachment;
    this.#attachContainer(container);

    this.#connection.open();
    handlers.onReady?.(this.#isReady);

    return () => {
      if (this.#attachment === attachment) this.#detach();
    };
  }

  close() {
    this.#connection.end();
    this.#resetTerminal();
  }

  sendInput(data: string) {
    if (!data) return;
    this.#connection.send(data);
    this.#xterm?.focus();
  }

  setShell(shell: string) {
    this.#shell = shell.trim() || undefined;
  }

  // Container lifecycle

  #attachContainer(container: HTMLDivElement) {
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

  #detach() {
    this.#attachment = null;
    this.#resize.uninstall();

    // Preserve the socket when React immediately remounts this shared terminal
    // into another container; a genuine detach still closes on the next task.
    setTimeout(() => {
      if (this.#attachment === null) this.#connection.close();
    });
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

      xterm.onData((data) => this.#connection.send(data));

      this.#xterm = xterm;
      this.#fitAddon = fitAddon;
      return;
    }

    this.#xterm.options.theme = theme;

    if (this.#xterm.element && this.#xterm.element.parentElement !== container) {
      container.innerHTML = "";
      container.appendChild(this.#xterm.element);
    }
  }

  // Connection event handlers

  #handleServerMessage(msg: TerminalServerMessage) {
    switch (msg.type) {
      case "ready":
        // A resumed shell replays its screen, so clear what is showing first.
        if (msg.resumed) {
          this.#xterm?.reset();
          this.#isReady = false;
        }
        break;

      case "exit":
        this.#connection.close();
        this.#resetTerminal();
        this.#attachment?.onClose?.();
        break;
    }
  }

  // Internal helpers

  #resetTerminal() {
    this.#xterm?.reset();
    this.#setReady(false);
  }

  #setReady(isReady: boolean) {
    this.#isReady = isReady;
    this.#attachment?.onReady?.(isReady);
  }
}

export const terminalManager = new TerminalManager();
