// ANSI control bytes used by the replay parser.
const ANSI_ESCAPE = 0x1b;
const ANSI_CSI = 0x5b; // [
const ANSI_PRIVATE_MARKER = 0x3f; // ?
const ANSI_SEMICOLON = 0x3b; // ;
const ANSI_DIGIT_ZERO = 0x30; // 0
const ANSI_DIGIT_NINE = 0x39; // 9
const ANSI_FINAL_MIN = 0x40;
const ANSI_FINAL_MAX = 0x7e;
const ANSI_SET_MODE = 0x68; // h
const ANSI_RESET_MODE = 0x6c; // l
const ANSI_ERASE_IN_DISPLAY = 0x4a; // J
const ANSI_FULL_RESET = 0x63; // c
const CLEAR_SCROLLBACK_PARAM = 3;

/** Private DEC modes that switch to the alternate screen. */
const ALT_BUFFER_MODES = new Set([47, 1047, 1049]);

const MAX_HISTORY_BYTES = 4 * 1024 * 1024;
const PAGE_BYTES = 64 * 1024;
const MAX_ESCAPE_SEQUENCE_BYTES = 64;
const textEncoder = new TextEncoder();

export class ScrollbackBuffer {
  // Normal-screen history, copied into fixed-size pages. Eviction drops the oldest
  // whole page, and replay sends one page per write.
  private pages: Uint8Array[] = [];
  private lastPageBytes = 0;
  private activeMode: "normal" | "alternate" = "normal";
  private pendingEscapeSequence = new Uint8Array(0);
  private privateModeStates = new Map<number, boolean>();

  private readonly maxBytes: number;
  private readonly pageBytes: number;

  /** Keeps at least `maxBytes` of the newest history, and less than a page more. */
  constructor({ maxBytes = MAX_HISTORY_BYTES, pageBytes = PAGE_BYTES } = {}) {
    this.maxBytes = maxBytes;
    this.pageBytes = pageBytes;
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
            this.pages = [];
          }
          cursor = escapeIndex + parsed.length;
          continue;

        case "reset":
          this.activeMode = "normal";
          this.privateModeStates.clear();
          this.pages = [];
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

  /**
   * Sends what a new socket needs to show the terminal as it is: the private-mode state
   * and, on the normal screen, its history. A full-screen app redraws itself instead.
   */
  replay(send: (chunk: Uint8Array) => void) {
    const alternate = this.activeMode === "alternate";
    const { setModes, resetModes } = this.collectPrivateModeState(alternate);
    this.sendPrivateModeReplay(send, setModes, resetModes);
    if (alternate) return;

    const last = this.pages.length - 1;
    this.pages.forEach((page, index) =>
      send(index === last ? page.subarray(0, this.lastPageBytes) : page),
    );
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

    for (let offset = 0; offset < chunk.byteLength;) {
      let page = this.pages.at(-1);
      if (!page || this.lastPageBytes === this.pageBytes) {
        page = new Uint8Array(this.pageBytes);
        this.pages.push(page);
        this.lastPageBytes = 0;
      }

      const bytes = chunk.subarray(offset, offset + this.pageBytes - this.lastPageBytes);
      page.set(bytes, this.lastPageBytes);
      this.lastPageBytes += bytes.byteLength;
      offset += bytes.byteLength;
    }

    // Drop the oldest page while the rest still hold the whole budget.
    while ((this.pages.length - 2) * this.pageBytes + this.lastPageBytes >= this.maxBytes) {
      this.pages.shift();
    }
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
