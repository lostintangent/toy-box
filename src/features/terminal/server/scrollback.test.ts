import { describe, expect, test } from "bun:test";
import { ScrollbackBuffer } from "./scrollback";

const ALT_BUFFER_ENTER_SEQUENCE = "\x1b[?1049h";
const ALT_BUFFER_EXIT_SEQUENCE = "\x1b[?1049l";
const CLEAR_SCROLLBACK_SEQUENCE = "\x1b[3J";
const TERMINAL_RESET_SEQUENCE = "\x1bc";

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

    test("replays only mode state while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("prompt$ "));
      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("ACTIVE TUI FRAME"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe(ALT_BUFFER_ENTER_SEQUENCE);
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

      const modeState = collectReplay(buffer).text;
      expect(modeState).toBe("\x1b[?1000;1006;1049h");
    });

    test("replays active private reset modes while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("\x1b[?1000h"));
      buffer.add(encode("\x1b[?25l"));

      const modeState = collectReplay(buffer).text;
      expect(modeState).toBe("\x1b[?1000;1049h\x1b[?25l");
    });

    test("replays private modes in reset state after being toggled off", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode("\x1b[?1000h"));
      buffer.add(encode("\x1b[?1000l"));

      const modeState = collectReplay(buffer).text;
      expect(modeState).toBe("\x1b[?1049h\x1b[?1000l");
    });

    test("does not replay alternate-buffer reset modes while alternate mode is active", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode(ALT_BUFFER_EXIT_SEQUENCE));
      buffer.add(encode("\x1b[?1047h"));
      buffer.add(encode("\x1b[?25l"));

      const modeState = collectReplay(buffer).text;
      expect(modeState).toBe("\x1b[?1047h\x1b[?25l");
    });

    test("replays only non-alternate private modes for normal-mode state", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode(ALT_BUFFER_ENTER_SEQUENCE));
      buffer.add(encode(ALT_BUFFER_EXIT_SEQUENCE));
      buffer.add(encode("\x1b[?2004h"));

      const normalState = collectReplay(buffer).text;
      expect(normalState).toBe("\x1b[?2004h");
    });

    test("replays cursor-hide reset mode in normal-mode state", () => {
      const buffer = new ScrollbackBuffer();

      buffer.add(encode("\x1b[?25l"));
      const normalState = collectReplay(buffer).text;
      expect(normalState).toBe("\x1b[?25l");
    });
  });

  describe("history budget", () => {
    test("keeps the newest output within the byte budget", () => {
      const buffer = new ScrollbackBuffer({ maxBytes: 10, pageBytes: 4 });

      buffer.add(encode("12345"));
      buffer.add(encode("6789"));
      buffer.add(encode("ABCDEFGHIJ"));

      const replay = collectReplay(buffer);
      expect(replay.text.endsWith("ABCDEFGHIJ")).toBe(true);
      expect(replay.text.length).toBeLessThan(10 + 4);
    });

    test("replays history in writes no larger than a page", () => {
      const buffer = new ScrollbackBuffer({ maxBytes: 1024, pageBytes: 8 });

      buffer.add(encode("abcd"));
      buffer.add(encode("efghijklmnopq"));
      buffer.add(encode("rs"));

      const replay = collectReplay(buffer);
      expect(replay.text).toBe("abcdefghijklmnopqrs");
      expect(replay.chunks.every((chunk) => chunk.byteLength <= 8)).toBe(true);
    });
  });
});
