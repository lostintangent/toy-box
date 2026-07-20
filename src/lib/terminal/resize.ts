/**
 * Observes container size changes and drives xterm.js fit/resize, with
 * throttling and pause support to avoid excessive relayouts during drag.
 */

import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { Throttler } from "@tanstack/pacer/throttler";

const FIT_THROTTLE_MS = 75;

export type TerminalResizeCallbacks = {
  onSizeChanged: (cols: number, rows: number) => void;
};

export function isValidSize(cols: number, rows: number) {
  return Number.isFinite(cols) && Number.isFinite(rows) && cols >= 2 && rows >= 1;
}

export class TerminalResize {
  readonly #callbacks: TerminalResizeCallbacks;
  readonly #fitThrottler: Throttler<() => void>;
  #resizeObserver: ResizeObserver | null = null;
  #fitRaf: number | null = null;
  #resizePaused = false;
  #pendingFit = false;

  #container: HTMLDivElement | null = null;
  #xterm: XTerm | null = null;
  #fitAddon: FitAddon | null = null;

  constructor(callbacks: TerminalResizeCallbacks) {
    this.#callbacks = callbacks;
    this.#fitThrottler = new Throttler(
      () => {
        if (this.#resizePaused) {
          this.#pendingFit = true;
          return;
        }
        if (this.#fitRaf !== null) return;

        this.#fitRaf = requestAnimationFrame(() => {
          this.#fitRaf = null;
          this.#applyFit();
        });
      },
      { wait: FIT_THROTTLE_MS },
    );
  }

  install(container: HTMLDivElement, xterm: XTerm, fitAddon: FitAddon) {
    this.uninstall();

    this.#container = container;
    this.#xterm = xterm;
    this.#fitAddon = fitAddon;
    this.#pendingFit = false;
    this.#fitThrottler.reset();

    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#resizePaused) {
        this.#pendingFit = true;
        return;
      }
      this.scheduleFit();
    });
    this.#resizeObserver.observe(container);
  }

  uninstall() {
    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }
    this.#cancelPendingFit();
    this.#container = null;
    this.#xterm = null;
    this.#fitAddon = null;
  }

  scheduleFit() {
    if (this.#resizePaused) {
      this.#pendingFit = true;
      return;
    }

    if (this.#fitRaf !== null) return;
    this.#fitThrottler.maybeExecute();
  }

  setResizePaused(paused: boolean) {
    this.#resizePaused = paused;
    if (paused && this.#fitThrottler.store.state.isPending) {
      this.#fitThrottler.cancel();
      this.#pendingFit = true;
      return;
    }
    if (!paused && this.#pendingFit) {
      this.#pendingFit = false;
      this.scheduleFit();
    }
  }

  dispose() {
    this.uninstall();
  }

  #applyFit() {
    if (!this.#container || !this.#xterm || !this.#fitAddon) return;
    const rect = this.#container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dims = this.#fitAddon.proposeDimensions();
    if (!dims) return;

    const cols = Math.floor(dims.cols);
    const rows = Math.floor(dims.rows);
    if (!isValidSize(cols, rows)) return;

    if (this.#xterm.cols !== cols || this.#xterm.rows !== rows) {
      this.#fitAddon.fit();
    }

    this.#callbacks.onSizeChanged(cols, rows);
  }

  #cancelPendingFit() {
    this.#fitThrottler.cancel();
    if (this.#fitRaf !== null) {
      cancelAnimationFrame(this.#fitRaf);
      this.#fitRaf = null;
    }
  }
}
