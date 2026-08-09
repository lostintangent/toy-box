import {
  ALT_BUFFER_MODES,
  ANSI_CSI,
  ANSI_DIGIT_NINE,
  ANSI_DIGIT_ZERO,
  ANSI_ERASE_IN_DISPLAY,
  ANSI_ESCAPE,
  ANSI_FINAL_MAX,
  ANSI_FINAL_MIN,
  ANSI_FULL_RESET,
  ANSI_PRIVATE_MARKER,
  ANSI_RESET_MODE,
  ANSI_SEMICOLON,
  ANSI_SET_MODE,
  CLEAR_SCROLLBACK_PARAM,
} from "./ansi";

const DEFAULT_SCROLLBACK_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_COALESCE_THRESHOLD_BYTES = 2048;
const DEFAULT_REPLAY_BATCH_BYTES = 64 * 1024;
const MAX_ESCAPE_SEQUENCE_BYTES = 64;
const textEncoder = new TextEncoder();

export interface ScrollbackBufferOptions {
  maxNormalBytes?: number;
  coalesceThresholdBytes?: number;
  replayBatchBytes?: number;
}

function normalizePositiveInt(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

class ByteBoundedChunkBuffer {
  private slots: Array<Uint8Array | undefined> = [];
  private head = 0;
  private count = 0;
  private totalBytes = 0;

  private readonly maxBytes: number;
  private readonly coalesceThresholdBytes: number;
  private readonly replayBatchBytes: number;

  constructor({
    maxBytes = DEFAULT_SCROLLBACK_MAX_BYTES,
    coalesceThresholdBytes = DEFAULT_COALESCE_THRESHOLD_BYTES,
    replayBatchBytes = DEFAULT_REPLAY_BATCH_BYTES,
  }: {
    maxBytes?: number;
    coalesceThresholdBytes?: number;
    replayBatchBytes?: number;
  } = {}) {
    this.maxBytes = normalizePositiveInt(maxBytes, DEFAULT_SCROLLBACK_MAX_BYTES);
    this.coalesceThresholdBytes = normalizeNonNegativeInt(
      coalesceThresholdBytes,
      DEFAULT_COALESCE_THRESHOLD_BYTES,
    );
    this.replayBatchBytes = normalizePositiveInt(replayBatchBytes, DEFAULT_REPLAY_BATCH_BYTES);
  }

  add(chunk: Uint8Array) {
    if (chunk.byteLength === 0) return;

    if (!this.tryCoalesceWithTail(chunk)) {
      this.pushBack(chunk);
    }
    this.trimOversizedTailChunk();
    this.evictToFitBudget();
  }

  replay(send: (chunk: Uint8Array) => void) {
    if (this.count === 0) return;

    const pending: Uint8Array[] = [];
    let pendingBytes = 0;

    const flush = () => {
      if (pendingBytes === 0) return;
      if (pending.length === 1) {
        send(pending[0]!);
      } else {
        const merged = new Uint8Array(pendingBytes);
        let offset = 0;
        for (const chunk of pending) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        send(merged);
      }
      pending.length = 0;
      pendingBytes = 0;
    };

    for (let offset = 0; offset < this.count; offset++) {
      const chunk = this.at(offset);
      if (!chunk || chunk.byteLength === 0) continue;

      if (pendingBytes === 0 && chunk.byteLength >= this.replayBatchBytes) {
        send(chunk);
        continue;
      }

      if (pendingBytes + chunk.byteLength > this.replayBatchBytes) {
        flush();
      }

      pending.push(chunk);
      pendingBytes += chunk.byteLength;
    }

    flush();
  }

  clear() {
    this.slots = [];
    this.head = 0;
    this.count = 0;
    this.totalBytes = 0;
  }

  private tryCoalesceWithTail(nextChunk: Uint8Array) {
    if (this.coalesceThresholdBytes === 0 || this.count === 0) {
      return false;
    }

    const tail = this.at(this.count - 1);
    if (!tail) return false;

    if (
      tail.byteLength >= this.coalesceThresholdBytes ||
      nextChunk.byteLength >= this.coalesceThresholdBytes
    ) {
      return false;
    }

    const mergedSize = tail.byteLength + nextChunk.byteLength;
    if (mergedSize > this.coalesceThresholdBytes) {
      return false;
    }

    const merged = new Uint8Array(mergedSize);
    merged.set(tail, 0);
    merged.set(nextChunk, tail.byteLength);
    this.replaceTail(merged);
    return true;
  }

  private evictToFitBudget() {
    while (this.totalBytes > this.maxBytes && this.count > 0) {
      this.popFront();
    }
  }

  private trimOversizedTailChunk() {
    if (this.count === 0) return;

    const tail = this.at(this.count - 1);
    if (!tail || tail.byteLength <= this.maxBytes) return;

    const trimmed = tail.subarray(tail.byteLength - this.maxBytes);
    this.replaceTail(trimmed);
  }

  private ensureCapacity(required: number) {
    if (this.slots.length >= required) return;

    const nextCapacity = Math.max(required, this.slots.length * 2, 8);
    const nextSlots = new Array<Uint8Array | undefined>(nextCapacity);
    for (let offset = 0; offset < this.count; offset++) {
      nextSlots[offset] = this.at(offset);
    }

    this.slots = nextSlots;
    this.head = 0;
  }

  private pushBack(chunk: Uint8Array) {
    this.ensureCapacity(this.count + 1);
    const index = (this.head + this.count) % this.slots.length;
    this.slots[index] = chunk;
    this.count++;
    this.totalBytes += chunk.byteLength;
  }

  private popFront() {
    if (this.count === 0) return;

    const chunk = this.slots[this.head];
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.slots.length;
    this.count--;
    this.totalBytes -= chunk?.byteLength ?? 0;

    if (this.count === 0) {
      this.head = 0;
    }
  }

  private replaceTail(nextChunk: Uint8Array) {
    const tailIndex = (this.head + this.count - 1) % this.slots.length;
    const prevChunk = this.slots[tailIndex];
    this.slots[tailIndex] = nextChunk;
    this.totalBytes += nextChunk.byteLength - (prevChunk?.byteLength ?? 0);
  }

  private at(offset: number) {
    if (offset < 0 || offset >= this.count || this.slots.length === 0) {
      return undefined;
    }
    return this.slots[(this.head + offset) % this.slots.length];
  }
}

export class ScrollbackBuffer {
  private normalBuffer: ByteBoundedChunkBuffer;
  private activeMode: "normal" | "alternate" = "normal";
  private pendingEscapeSequence = new Uint8Array(0);
  private privateModeStates = new Map<number, boolean>();

  constructor(options: ScrollbackBufferOptions = {}) {
    this.normalBuffer = new ByteBoundedChunkBuffer({
      maxBytes: options.maxNormalBytes,
      coalesceThresholdBytes: options.coalesceThresholdBytes,
      replayBatchBytes: options.replayBatchBytes,
    });
  }

  add(data: Uint8Array) {
    if (data.byteLength === 0) return;

    const chunk = this.mergeCarry(data);
    let cursor = 0;
    while (cursor < chunk.byteLength) {
      const escapeIndex = chunk.indexOf(ANSI_ESCAPE, cursor);
      if (escapeIndex === -1) {
        this.appendToNormalBufferIfVisible(chunk.subarray(cursor));
        return;
      }

      if (escapeIndex > cursor) {
        this.appendToNormalBufferIfVisible(chunk.subarray(cursor, escapeIndex));
      }

      const parsed = this.parseEscapeCommand(chunk, escapeIndex);
      if (parsed.kind === "incomplete") {
        this.pendingEscapeSequence = new Uint8Array(chunk.subarray(escapeIndex));
        return;
      }

      switch (parsed.kind) {
        case "alt-enter":
          this.activeMode = "alternate";
          cursor = escapeIndex + parsed.length;
          continue;

        case "alt-exit":
          this.activeMode = "normal";
          cursor = escapeIndex + parsed.length;
          continue;

        case "clear-scrollback":
          if (this.activeMode === "normal") {
            this.normalBuffer.clear();
          }
          cursor = escapeIndex + parsed.length;
          continue;

        case "reset":
          this.activeMode = "normal";
          this.privateModeStates.clear();
          this.normalBuffer.clear();
          cursor = escapeIndex + parsed.length;
          continue;

        case "private-mode":
          cursor = escapeIndex + parsed.length;
          continue;

        case "passthrough":
          this.appendToNormalBufferIfVisible(
            chunk.subarray(escapeIndex, escapeIndex + parsed.length),
          );
          cursor = escapeIndex + parsed.length;
          continue;
      }

      // Unknown/incomplete-like escape prefix: preserve the ESC byte in normal mode.
      this.appendToNormalBufferIfVisible(chunk.subarray(escapeIndex, escapeIndex + 1));
      cursor = escapeIndex + 1;
    }
  }

  replay(send: (chunk: Uint8Array) => void) {
    if (this.activeMode !== "normal") return;
    this.replayModeState(send);
    this.normalBuffer.replay(send);
  }

  replayModeState(send: (chunk: Uint8Array) => void) {
    const { setModes, resetModes } = this.collectPrivateModeState(this.activeMode === "alternate");
    this.sendPrivateModeReplay(send, setModes, resetModes);
  }

  isAlternateMode() {
    return this.activeMode === "alternate";
  }

  private mergeCarry(data: Uint8Array) {
    if (this.pendingEscapeSequence.byteLength === 0) {
      return data;
    }

    const combined = new Uint8Array(this.pendingEscapeSequence.byteLength + data.byteLength);
    combined.set(this.pendingEscapeSequence, 0);
    combined.set(data, this.pendingEscapeSequence.byteLength);
    this.pendingEscapeSequence = new Uint8Array(0);
    return combined;
  }

  private appendToNormalBufferIfVisible(chunk: Uint8Array) {
    if (this.activeMode !== "normal") return;
    if (chunk.byteLength === 0) return;
    this.normalBuffer.add(chunk);
  }

  private parseEscapeCommand(
    chunk: Uint8Array,
    start: number,
  ):
    | { kind: "incomplete" }
    | { kind: "none" }
    | { kind: "passthrough"; length: number }
    | { kind: "private-mode"; length: number }
    | { kind: "alt-enter"; length: number }
    | { kind: "alt-exit"; length: number }
    | { kind: "clear-scrollback"; length: number }
    | { kind: "reset"; length: number } {
    if (start + 1 >= chunk.byteLength) return { kind: "incomplete" };

    const next = chunk[start + 1];
    if (next === ANSI_FULL_RESET) {
      return { kind: "reset", length: 2 };
    }
    if (next !== ANSI_CSI) {
      return { kind: "none" };
    }

    const parsedCsi = this.parseCsiSequence(chunk, start);
    if (parsedCsi.kind !== "complete") {
      return parsedCsi;
    }

    const { finalByte, isPrivate, params, length } = parsedCsi;
    if (isPrivate) {
      this.applyPrivateModeTransition(finalByte, params);
      const includesAltMode = params.some((param) => ALT_BUFFER_MODES.has(param));
      if (!includesAltMode) {
        return { kind: "private-mode", length };
      }
      if (finalByte === ANSI_SET_MODE) {
        return { kind: "alt-enter", length };
      }
      if (finalByte === ANSI_RESET_MODE) {
        return { kind: "alt-exit", length };
      }
      return { kind: "passthrough", length };
    }

    if (
      finalByte === ANSI_ERASE_IN_DISPLAY &&
      params.some((param) => param === CLEAR_SCROLLBACK_PARAM)
    ) {
      return { kind: "clear-scrollback", length };
    }

    return { kind: "passthrough", length };
  }

  private applyPrivateModeTransition(finalByte: number, params: number[]) {
    if (finalByte !== ANSI_SET_MODE && finalByte !== ANSI_RESET_MODE) {
      return;
    }

    const isSetMode = finalByte === ANSI_SET_MODE;
    for (const param of params) {
      if (param < 0) continue;
      this.privateModeStates.set(param, isSetMode);
    }
  }

  private collectPrivateModeState(includeAltSetModes: boolean) {
    const setModes: number[] = [];
    const resetModes: number[] = [];
    for (const [mode, isSetMode] of this.privateModeStates) {
      const isAltMode = ALT_BUFFER_MODES.has(mode);
      if (isSetMode) {
        if (isAltMode && !includeAltSetModes) {
          continue;
        }
        setModes.push(mode);
      } else {
        if (isAltMode) {
          continue;
        }
        resetModes.push(mode);
      }
    }
    setModes.sort((a, b) => a - b);
    resetModes.sort((a, b) => a - b);
    return { setModes, resetModes };
  }

  private sendPrivateModeReplay(
    send: (chunk: Uint8Array) => void,
    setModes: number[],
    resetModes: number[],
  ) {
    if (setModes.length > 0) {
      send(textEncoder.encode(`\x1b[?${setModes.join(";")}h`));
    }
    if (resetModes.length > 0) {
      send(textEncoder.encode(`\x1b[?${resetModes.join(";")}l`));
    }
  }

  private parseCsiSequence(
    chunk: Uint8Array,
    start: number,
  ):
    | { kind: "none" }
    | { kind: "incomplete" }
    | {
        kind: "complete";
        length: number;
        isPrivate: boolean;
        finalByte: number;
        params: number[];
      } {
    let index = start + 2;
    if (index >= chunk.byteLength) {
      return { kind: "incomplete" };
    }

    let isPrivate = false;
    if (chunk[index] === ANSI_PRIVATE_MARKER) {
      isPrivate = true;
      index++;
    }

    let currentParam = -1;
    const params: number[] = [];

    while (index < chunk.byteLength && index - start <= MAX_ESCAPE_SEQUENCE_BYTES) {
      const byte = chunk[index];

      if (byte >= ANSI_DIGIT_ZERO && byte <= ANSI_DIGIT_NINE) {
        currentParam =
          currentParam === -1 ? byte - ANSI_DIGIT_ZERO : currentParam * 10 + byte - ANSI_DIGIT_ZERO;
        index++;
        continue;
      }

      if (byte === ANSI_SEMICOLON) {
        params.push(currentParam);
        currentParam = -1;
        index++;
        continue;
      }

      if (byte >= 0x20 && byte <= 0x2f) {
        index++;
        continue;
      }

      if (byte >= ANSI_FINAL_MIN && byte <= ANSI_FINAL_MAX) {
        if (currentParam !== -1) {
          params.push(currentParam);
        }
        return {
          kind: "complete",
          length: index - start + 1,
          isPrivate,
          finalByte: byte,
          params,
        };
      }

      return { kind: "none" };
    }

    if (index - start > MAX_ESCAPE_SEQUENCE_BYTES) {
      return { kind: "none" };
    }
    return { kind: "incomplete" };
  }
}
