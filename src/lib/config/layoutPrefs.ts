export const SIDEBAR_SIZE_COOKIE = "toybox_sidebar_size";
export const TERMINAL_SIZE_COOKIE = "toybox_terminal_size";
export const SIDEBAR_OPEN_COOKIE = "toybox_sidebar_open";
export const TERMINAL_OPEN_COOKIE = "toybox_terminal_open";
export const AUTOMATIONS_EXPANDED_COOKIE = "toybox_automations_expanded";
export const LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_SIDEBAR_SIZE = 15;
export const DEFAULT_TERMINAL_SIZE = 30;
export const DEFAULT_AUTOMATIONS_EXPANDED = true;

export const SIDEBAR_MIN_SIZE = 10;
export const SIDEBAR_MAX_SIZE = 40;
export const TERMINAL_MIN_SIZE = 15;
export const TERMINAL_MAX_SIZE = 80;

export type LayoutPrefs = {
  sidebarSize: number;
  terminalSize: number;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  automationsExpanded: boolean;
};

function parseCookies(header?: string | null): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const trimmed = part.trim();
    if (!trimmed) return acc;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return acc;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (name) acc[name] = value;
    return acc;
  }, {});
}

function parseCookieNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCookieBoolean(value?: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function parseLayoutPrefs(cookieHeader?: string | null): Partial<LayoutPrefs> {
  const cookies = parseCookies(cookieHeader);
  return {
    sidebarSize: parseCookieNumber(cookies[SIDEBAR_SIZE_COOKIE]),
    terminalSize: parseCookieNumber(cookies[TERMINAL_SIZE_COOKIE]),
    sidebarOpen: parseCookieBoolean(cookies[SIDEBAR_OPEN_COOKIE]),
    terminalOpen: parseCookieBoolean(cookies[TERMINAL_OPEN_COOKIE]),
    automationsExpanded: parseCookieBoolean(cookies[AUTOMATIONS_EXPANDED_COOKIE]),
  };
}

export function clampSidebarSize(value: number): number {
  return Math.min(SIDEBAR_MAX_SIZE, Math.max(SIDEBAR_MIN_SIZE, value));
}

export function clampTerminalSize(value: number): number {
  return Math.min(TERMINAL_MAX_SIZE, Math.max(TERMINAL_MIN_SIZE, value));
}

export function resolveLayoutPrefs(prefs: Partial<LayoutPrefs>): LayoutPrefs {
  return {
    sidebarSize: clampSidebarSize(prefs.sidebarSize ?? DEFAULT_SIDEBAR_SIZE),
    terminalSize: clampTerminalSize(prefs.terminalSize ?? DEFAULT_TERMINAL_SIZE),
    sidebarOpen: prefs.sidebarOpen ?? true,
    terminalOpen: prefs.terminalOpen ?? false,
    automationsExpanded: prefs.automationsExpanded ?? DEFAULT_AUTOMATIONS_EXPANDED,
  };
}

export function buildLayoutCookie(name: string, value: string | number | boolean): string {
  return `${name}=${String(value)}; Path=/; Max-Age=${LAYOUT_COOKIE_MAX_AGE}; SameSite=Lax`;
}
