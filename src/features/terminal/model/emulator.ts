import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal as BrowserTerminal } from "@xterm/xterm";

/**
 * The browser's terminal and the server's mirror of it emulate alike, so a replayed screen
 * lays out exactly as the browser drew it.
 */
export const emulatorOptions = { scrollback: 1000, allowProposedApi: true } as const;

/** Measures wide characters and emoji by Unicode 11 on both sides. */
export function loadUnicode11(terminal: BrowserTerminal | HeadlessTerminal) {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
}
