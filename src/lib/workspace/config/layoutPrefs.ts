// Layout preferences round-trip through cookies so SSR and the hydrated shell
// start with the same sidebar, terminal, automation, Hyper, and mobile Inbox layout.

const LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEFAULT_SIDEBAR_SIZE = 15;
const DEFAULT_TERMINAL_SIZE = 30;
const DEFAULT_AUTOMATIONS_EXPANDED = true;
const DEFAULT_MOBILE_INBOX_OPEN = false;

const SIDEBAR_MIN_SIZE = 10;
const SIDEBAR_MAX_SIZE = 40;
const TERMINAL_MIN_SIZE = 15;
const TERMINAL_MAX_SIZE = 80;

type Point = { x: number; y: number };

const DEFAULT_HYPER_POSITION: Point = { x: 24, y: 24 };

function clampSidebarSize(value: number): number {
  return Math.min(SIDEBAR_MAX_SIZE, Math.max(SIDEBAR_MIN_SIZE, value));
}

function clampTerminalSize(value: number): number {
  return Math.min(TERMINAL_MAX_SIZE, Math.max(TERMINAL_MIN_SIZE, value));
}

type CookieCodec<T> = {
  parse: (raw: string) => T | undefined;
  serialize?: (value: T) => string;
};

const booleanCodec: CookieCodec<boolean> = {
  parse: (raw) => (raw === "true" ? true : raw === "false" ? false : undefined),
};

const numberCodec = (clamp: (value: number) => number): CookieCodec<number> => ({
  parse: (raw) => {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : undefined;
  },
});

const pointCodec: CookieCodec<Point> = {
  parse: (raw) => {
    const [x, y] = raw.split(",").map((part) => Number.parseFloat(part));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
  },
  serialize: ({ x, y }) => `${x},${y}`,
};

// Cookies share a jar across ports, so names are app-specific. This registry is
// the single declaration of each preference's name, wire codec, and default.
const COOKIE_PREFIX = "toybox_";

type LayoutPref<T> = { cookie: string; codec: CookieCodec<T>; default: T };

function pref<T>(name: string, codec: CookieCodec<T>, fallback: T): LayoutPref<T> {
  return { cookie: `${COOKIE_PREFIX}${name}`, codec, default: fallback };
}

const LAYOUT_PREFS = {
  sidebarSize: pref("sidebar_size", numberCodec(clampSidebarSize), DEFAULT_SIDEBAR_SIZE),
  terminalSize: pref("terminal_size", numberCodec(clampTerminalSize), DEFAULT_TERMINAL_SIZE),
  sidebarOpen: pref("sidebar_open", booleanCodec, true),
  terminalOpen: pref("terminal_open", booleanCodec, false),
  automationsExpanded: pref("automations_expanded", booleanCodec, DEFAULT_AUTOMATIONS_EXPANDED),
  hyperOpen: pref("hyper_open", booleanCodec, false),
  hyperPosition: pref("hyper_pos", pointCodec, DEFAULT_HYPER_POSITION),
  mobileInboxOpen: pref("mobile_inbox_open", booleanCodec, DEFAULT_MOBILE_INBOX_OPEN),
};

export type LayoutPrefKey = keyof typeof LAYOUT_PREFS;

export type LayoutPrefs = {
  [K in LayoutPrefKey]: (typeof LAYOUT_PREFS)[K] extends LayoutPref<infer T> ? T : never;
};

const LAYOUT_PREF_KEYS = Object.keys(LAYOUT_PREFS) as LayoutPrefKey[];

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

export function parseLayoutPrefs(cookieHeader?: string | null): Partial<LayoutPrefs> {
  const cookies = parseCookies(cookieHeader);
  const prefs: Record<string, unknown> = {};

  for (const key of LAYOUT_PREF_KEYS) {
    const { cookie, codec } = LAYOUT_PREFS[key];
    const raw = cookies[cookie];
    const value = raw === undefined ? undefined : codec.parse(raw);
    if (value !== undefined) prefs[key] = value;
  }

  return prefs as Partial<LayoutPrefs>;
}

export function resolveLayoutPrefs(prefs: Partial<LayoutPrefs>): LayoutPrefs {
  const resolved: Record<string, unknown> = {};

  for (const key of LAYOUT_PREF_KEYS) {
    resolved[key] = prefs[key] ?? LAYOUT_PREFS[key].default;
  }

  return resolved as LayoutPrefs;
}

function buildLayoutCookie(name: string, value: string | number | boolean): string {
  return `${name}=${String(value)}; Path=/; Max-Age=${LAYOUT_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function serializeLayoutCookie<K extends LayoutPrefKey>(
  key: K,
  value: LayoutPrefs[K],
): string {
  const { cookie, codec } = LAYOUT_PREFS[key];
  const serialize = (codec.serialize ?? String) as (value: LayoutPrefs[K]) => string;
  return buildLayoutCookie(cookie, serialize(value));
}
