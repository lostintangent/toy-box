/**
 * Bidirectional buffering for terminal I/O. Queues keyboard input while
 * the connection is initializing, and coalesces PTY output into batched
 * writes to minimize xterm.js reflows.
 */

const MAX_PENDING_INPUT_CHARS = 32 * 1024;
const OUTPUT_FLUSH_INTERVAL_MS = 8;
const MAX_PENDING_OUTPUT_BYTES = 64 * 1024;

export type TerminalBufferCallbacks = {
  isReadyToSend: () => boolean;
  writeToPty: (data: string) => void;
  writeToXterm: (data: Uint8Array) => void;
  onFirstOutput: () => void;
  ensureConnection: () => void;
};

export class TerminalBuffer {
  readonly #callbacks: TerminalBufferCallbacks;
  #pendingInput = "";
  #pendingOutputChunks: Uint8Array[] = [];
  #pendingOutputBytes = 0;
  #outputFlushTimeout: ReturnType<typeof setTimeout> | null = null;
  #hasReceivedOutput = false;

  constructor(callbacks: TerminalBufferCallbacks) {
    this.#callbacks = callbacks;
  }

  bufferInput(data: string) {
    if (this.#callbacks.isReadyToSend()) {
      this.#callbacks.writeToPty(data);
      return;
    }

    this.#pendingInput = (this.#pendingInput + data).slice(-MAX_PENDING_INPUT_CHARS);
    this.#callbacks.ensureConnection();
  }

  flushPendingInput() {
    if (!this.#pendingInput) return;
    if (!this.#callbacks.isReadyToSend()) return;

    this.#callbacks.writeToPty(this.#pendingInput);
    this.#pendingInput = "";
  }

  bufferOutput(data: Uint8Array) {
    if (data.byteLength === 0) return;

    this.#pendingOutputChunks.push(data);
    this.#pendingOutputBytes += data.byteLength;

    if (this.#pendingOutputBytes >= MAX_PENDING_OUTPUT_BYTES) {
      this.flushOutputBuffer();
    } else {
      this.#scheduleOutputFlush();
    }

    if (!this.#hasReceivedOutput) {
      this.#hasReceivedOutput = true;
      this.#callbacks.onFirstOutput();
    }
  }

  flushOutputBuffer() {
    if (this.#pendingOutputChunks.length === 0) return;

    const chunks = this.#pendingOutputChunks;
    this.#pendingOutputChunks = [];
    this.#pendingOutputBytes = 0;

    if (chunks.length === 1) {
      this.#callbacks.writeToXterm(chunks[0]!);
      return;
    }

    let totalBytes = 0;
    for (const part of chunks) {
      totalBytes += part.byteLength;
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const part of chunks) {
      combined.set(part, offset);
      offset += part.byteLength;
    }

    this.#callbacks.writeToXterm(combined);
  }

  resetOutputBuffer() {
    this.#clearOutputFlushTimeout();
    this.#pendingOutputChunks = [];
    this.#pendingOutputBytes = 0;
    this.#hasReceivedOutput = false;
  }

  clearPendingInput() {
    this.#pendingInput = "";
  }

  dispose() {
    this.resetOutputBuffer();
    this.clearPendingInput();
  }

  #scheduleOutputFlush() {
    if (this.#outputFlushTimeout !== null) return;
    this.#outputFlushTimeout = setTimeout(() => {
      this.#outputFlushTimeout = null;
      this.flushOutputBuffer();
    }, OUTPUT_FLUSH_INTERVAL_MS);
  }

  #clearOutputFlushTimeout() {
    if (this.#outputFlushTimeout === null) return;
    clearTimeout(this.#outputFlushTimeout);
    this.#outputFlushTimeout = null;
  }
}
