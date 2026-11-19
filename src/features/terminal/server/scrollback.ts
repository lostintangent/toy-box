import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";
import { emulatorOptions, loadUnicode11 } from "../model/emulator";

const textEncoder = new TextEncoder();

/** Holds the screen and scrollback of a PTY for a reconnecting browser. */
export class ScrollbackBuffer extends Terminal {
  #serializer = new SerializeAddon();

  constructor(cols: number, rows: number) {
    super({ ...emulatorOptions, cols, rows });

    loadUnicode11(this);
    this.loadAddon(this.#serializer);
  }

  replay() {
    return textEncoder.encode(this.#serializer.serialize() + this.#restoreModes());
  }

  /** Workaround for state omitted by @xterm/addon-serialize 0.14.0. */
  #restoreModes() {
    const { _core: core } = this as this & {
      _core: {
        coreService: { isCursorHidden: boolean };
        coreMouseService: { activeEncoding: string };
        _bufferService: { buffer: { scrollTop: number; scrollBottom: number } };
      };
    };
    let restore = "";
    if (core.coreService.isCursorHidden) restore += "\x1b[?25l";
    if (core.coreMouseService.activeEncoding === "SGR") restore += "\x1b[?1006h";
    if (core.coreMouseService.activeEncoding === "SGR_PIXELS") restore += "\x1b[?1016h";

    const { scrollTop, scrollBottom } = core._bufferService.buffer;
    const hasRegion = scrollTop !== 0 || scrollBottom !== this.rows - 1;
    const { originMode } = this.modes;
    if (hasRegion) restore += `\x1b[${scrollTop + 1};${scrollBottom + 1}r`;
    // Both setting a region and the serializer's DECOM restore home the cursor.
    if (hasRegion || originMode) {
      const { cursorX, cursorY } = this.buffer.active;
      restore += `\x1b[${cursorY + 1 - (originMode ? scrollTop : 0)};${cursorX + 1}H`;
    }

    return restore;
  }
}
