// ANSI control bytes used by the terminal replay parser.

export const ANSI_ESCAPE = 0x1b;
export const ANSI_CSI = 0x5b; // [
export const ANSI_PRIVATE_MARKER = 0x3f; // ?
export const ANSI_SEMICOLON = 0x3b; // ;
export const ANSI_DIGIT_ZERO = 0x30; // 0
export const ANSI_DIGIT_NINE = 0x39; // 9
export const ANSI_FINAL_MIN = 0x40;
export const ANSI_FINAL_MAX = 0x7e;
export const ANSI_SET_MODE = 0x68; // h
export const ANSI_RESET_MODE = 0x6c; // l
export const ANSI_ERASE_IN_DISPLAY = 0x4a; // J
export const ANSI_FULL_RESET = 0x63; // c
export const CLEAR_SCROLLBACK_PARAM = 3;

// Private DEC modes used by alternate-screen terminals.

export const ALT_BUFFER_MODES = new Set([47, 1047, 1049]);
export const ALT_BUFFER_ENTER_SEQUENCE = "\x1b[?1049h";
export const ALT_BUFFER_EXIT_SEQUENCE = "\x1b[?1049l";
export const CLEAR_SCROLLBACK_SEQUENCE = "\x1b[3J";
export const TERMINAL_RESET_SEQUENCE = "\x1bc";
