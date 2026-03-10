import { describe, expect, test } from "bun:test";
import {
  ALT_BUFFER_ENTER_SEQUENCE,
  ALT_BUFFER_EXIT_SEQUENCE,
  CLEAR_SCROLLBACK_SEQUENCE,
  TERMINAL_RESET_SEQUENCE,
} from "./ansi";
import { ScrollbackBuffer } from "./scrollback";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encode(text: string) {
  return textEncoder.encode(text);
}

function collectReplay(buffer: ScrollbackBuffer) {
  const chunks: Uint8Array[] = [];
  buffer.replay((chunk) => {
    chunks.push(chunk);
  });

  return {
    chunks,
    text: chunks.map((chunk) => textDecoder.decode(chunk)).join(""),
  };
}

function collectModeState(buffer: ScrollbackBuffer) {
  const chunks: Uint8Array[] = [];
  buffer.replayModeState((chunk) => {
    chunks.push(chunk);
  });

  return chunks.map((chunk) => textDecoder.decode(chunk)).join("");
}

describe("ScrollbackBuffer", () => {
  describe("common terminal scenarios", () => {
    test("replays only normal-mode output when alternate mode has exited", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("prompt$ "));
      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("TUI FRAME"));
      buffer.add(encode(ALT_BUFFER_EXIT_SEQUENCE));
      buffer.add(encode("after-tui\n"));

      const replay = collectReplay(buffer);
      expect(replay.text).toContain("prompt$ ");
      expect(replay.text).toContain("after-tui\n");
      expect(replay.text).not.toContain("TUI FRAME");
    });

    test("replay is skipped while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("prompt$ "));
      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("ACTIVE TUI FRAME"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("");
      expect(buffer.isAlternateMode()).toBe(true);
    });

    test("clear scrollback in normal mode drops prior normal history", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("before-clear\n"));
      buffer.add(encode(CLEAR_SCROLLBACK_SEQUENCE));
      buffer.add(encode("after-clear\n"));

      const replay = collectReplay(buffer);
      expect(replay.text).toContain("after-clear\n");
      expect(replay.text).not.toContain("before-clear\n");
    });

    test("terminal reset clears history and returns to normal mode", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("before-reset\n"));
      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("ACTIVE TUI FRAME"));
      buffer.add(encode(TERMINAL_RESET_SEQUENCE));
      buffer.add(encode("after-reset\n"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("after-reset\n");
      expect(buffer.isAlternateMode()).toBe(false);
    });

    test("replays normal-mode private state before normal scrollback", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("\x1b[?2004h"));
      buffer.add(encode("prompt$ "));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("\x1b[?2004hprompt$ ");
    });
  });

  describe("streaming and parser edge cases", () => {
    test("handles alternate-buffer mode sequences split across chunks", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("prompt$ "));
      buffer.add(encode("\x1b[?10"));
      buffer.add(encode("49hACTIVE TUI FRAME"));
      buffer.add(encode("\x1b[?10"));
      buffer.add(encode("49l"));
      buffer.add(encode("after-tui\n"));

      const replay = collectReplay(buffer);
      expect(replay.text).toContain("prompt$ ");
      expect(replay.text).toContain("after-tui\n");
      expect(replay.text).not.toContain("ACTIVE TUI FRAME");
    });

    test("handles clear-scrollback CSI sequence split across chunks", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("before-clear\n"));
      buffer.add(encode("\x1b[3"));
      buffer.add(encode("J"));
      buffer.add(encode("after-clear\n"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("after-clear\n");
    });

    test("clear scrollback in alternate mode preserves normal history", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("before-alt\n"));
      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode(CLEAR_SCROLLBACK_SEQUENCE));
      buffer.add(encode("ALT FRAME"));
      buffer.add(encode(ALT_BUFFER_EXIT_SEQUENCE));
      buffer.add(encode("after-alt\n"));

      const replay = collectReplay(buffer);
      expect(replay.text).toContain("before-alt\n");
      expect(replay.text).toContain("after-alt\n");
      expect(replay.text).not.toContain("ALT FRAME");
    });

    test("replays active private modes while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("\x1b[?1006h"));
      buffer.add(encode("\x1b[?1000h"));

      const modeState = collectModeState(buffer);
      expect(modeState).toBe("\x1b[?1000;1006;1049h");
    });

    test("replays active private reset modes while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("\x1b[?1000h"));
      buffer.add(encode("\x1b[?25l"));

      const modeState = collectModeState(buffer);
      expect(modeState).toBe("\x1b[?1000;1049h\x1b[?25l");
    });

    test("replays private modes in reset state after being toggled off", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("\x1b[?1000h"));
      buffer.add(encode("\x1b[?1000l"));

      const modeState = collectModeState(buffer);
      expect(modeState).toBe("\x1b[?1049h\x1b[?1000l");
    });

    test("does not replay alternate-buffer reset modes while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode(ALT_BUFFER_EXIT_SEQUENCE));
      buffer.add(encode("\x1b[?1047h"));
      buffer.add(encode("\x1b[?25l"));

      const modeState = collectModeState(buffer);
      expect(modeState).toBe("\x1b[?1047h\x1b[?25l");
    });

    test("replays only non-alternate private modes for normal-mode state", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode(ALT_BUFFER_EXIT_SEQUENCE));
      buffer.add(encode("\x1b[?2004h"));

      const normalState = collectModeState(buffer);
      expect(normalState).toBe("\x1b[?2004h");
    });

    test("replays cursor-hide reset mode in normal-mode state", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("\x1b[?25l"));
      const normalState = collectModeState(buffer);
      expect(normalState).toBe("\x1b[?25l");
    });
  });

  describe("memory and replay performance behavior", () => {
    test("evicts oldest chunks when byte budget is exceeded", () => {
      const buffer = new ScrollbackBuffer({
        maxNormalBytes: 10,
        coalesceThresholdBytes: 0,
        replayBatchBytes: 64,
      });

      buffer.add(encode("12345"));
      buffer.add(encode("6789"));
      buffer.add(encode("ABCD"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("6789ABCD");
    });

    test("keeps newest bytes when a single chunk exceeds the byte budget", () => {
      const buffer = new ScrollbackBuffer({
        maxNormalBytes: 5,
        coalesceThresholdBytes: 0,
        replayBatchBytes: 64,
      });

      buffer.add(encode("1234567890"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("67890");
    });

    test("coalesces small chunks before replay", () => {
      const buffer = new ScrollbackBuffer({
        maxNormalBytes: 1024,
        coalesceThresholdBytes: 16,
        replayBatchBytes: 64,
      });

      buffer.add(encode("a"));
      buffer.add(encode("b"));
      buffer.add(encode("c"));
      buffer.add(encode("d"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("abcd");
      expect(replay.chunks).toHaveLength(1);
    });

    test("replay batches multiple chunks into fewer websocket writes", () => {
      const buffer = new ScrollbackBuffer({
        maxNormalBytes: 1024,
        coalesceThresholdBytes: 0,
        replayBatchBytes: 8,
      });

      buffer.add(encode("abcd"));
      buffer.add(encode("ef"));
      buffer.add(encode("gh"));
      buffer.add(encode("ij"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("abcdefghij");
      expect(replay.chunks).toHaveLength(2);
      expect(textDecoder.decode(replay.chunks[0]!)).toBe("abcdefgh");
      expect(textDecoder.decode(replay.chunks[1]!)).toBe("ij");
    });

    test("does not lose all history when coalescing creates an oversized tail chunk", () => {
      const buffer = new ScrollbackBuffer({
        maxNormalBytes: 10,
        coalesceThresholdBytes: 16,
        replayBatchBytes: 64,
      });

      buffer.add(encode("123456"));
      buffer.add(encode("789012"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("3456789012");
    });
  });
});
