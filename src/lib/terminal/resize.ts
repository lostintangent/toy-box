/**
 * Keeps xterm fitted to its container.
 *
 * Pointer drags, panel open/close animations and window resizes all reach the
 * terminal the same way: as a burst of intermediate container sizes. Refitting
 * on those reflows the grid to widths nobody asked for, so a container change
 * only fits once the size has settled. Moments the terminal chooses itself,
 * like attaching a container or fonts finishing, are already settled and fit
 * straight away.
 */

import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { Debouncer } from "@tanstack/pacer/debouncer";

/** How long the container must hold one size before it counts as settled. */
export const SETTLE_MS = 100;

export type TerminalResizeCallbacks = {
  onSizeChanged: (cols: number, rows: number) => void;
};

export function isValidSize(cols: number, rows: number) {
  return Number.isFinite(cols) && Number.isFinite(rows) && cols >= 2 && rows >= 1;
}

export class TerminalResize {
  readonly #callbacks: TerminalResizeCallbacks;
  readonly #settle: Debouncer<() => void>;
  #resizeObserver: ResizeObserver | null = null;

  #container: HTMLDivElement | null = null;
  #xterm: XTerm | null = null;
  #fitAddon: FitAddon | null = null;

  constructor(callbacks: TerminalResizeCallbacks) {
    this.#callbacks = callbacks;
    this.#settle = new Debouncer(() => this.fit(), { wait: SETTLE_MS });
  }

  install(container: HTMLDivElement, xterm: XTerm, fitAddon: FitAddon) {
    this.uninstall();

    this.#container = container;
    this.#xterm = xterm;
    this.#fitAddon = fitAddon;

    this.#resizeObserver = new ResizeObserver(() => this.#settle.maybeExecute());
    this.#resizeObserver.observe(container);
  }

  uninstall() {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#settle.cancel();

    this.#container = null;
    this.#xterm = null;
    this.#fitAddon = null;
  }

  /** Fit the grid to the container as it stands now. */
  fit() {
    if (!this.#container || !this.#xterm || !this.#fitAddon) return;

    const { width, height } = this.#container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const dimensions = this.#fitAddon.proposeDimensions();
    if (!dimensions) return;

    const cols = Math.floor(dimensions.cols);
    const rows = Math.floor(dimensions.rows);
    if (!isValidSize(cols, rows)) return;

    if (this.#xterm.cols !== cols || this.#xterm.rows !== rows) this.#fitAddon.fit();
    this.#callbacks.onSizeChanged(cols, rows);
  }

  dispose() {
    this.uninstall();
  }
}
