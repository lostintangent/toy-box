// Layout preferences that round-trip through cookies so SSR can render the shell
// (sidebar, terminal, hyper deck) in the same shape the user last left it, before
// the client hydrates. Each pref is declared once in LAYOUT_PREFS; parsing,
// defaulting, and writing all derive from that table.

export const LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_SIDEBAR_SIZE = 15;
export const DEFAULT_TERMINAL_SIZE = 30;
export const DEFAULT_AUTOMATIONS_EXPANDED = true;

export const SIDEBAR_MIN_SIZE = 10;
export const SIDEBAR_MAX_SIZE = 40;
export const TERMINAL_MIN_SIZE = 15;
export const TERMINAL_MAX_SIZE = 80;

export type Point = { x: number; y: number };

export const DEFAULT_HYPER_POSITION: Point = { x: 24, y: 24 };

export function clampSidebarSize(value: number): number {
  return Math.min(SIDEBAR_MAX_SIZE, Math.max(SIDEBAR_MIN_SIZE, value));
}

export function clampTerminalSize(value: number): number {
  return Math.min(TERMINAL_MAX_SIZE, Math.max(TERMINAL_MIN_SIZE, value));
}

// ── Cookie codecs ─────────────────────────────────────────────────────────────
// A codec is the single home for one pref's wire encoding. `parse` returns
// undefined for an absent or invalid cookie so callers fall back to the default;
// size clamps live in the codec so they apply on every read. `serialize` defaults
// to `String`, so only non-primitive values (e.g. a point) need their own.

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

// ── Pref registry ─────────────────────────────────────────────────────────────
// One entry per round-tripped pref — cookie name, codec, and default. `pref`
// infers each value type from its codec and checks the default against it. Adding
// a pref is one line here plus one `useLayoutCookie` call at its owner.

// Cookies share one jar per host across ports (localhost dev especially), so we
// namespace every name to avoid colliding with another app's `sidebar_open`.
const COOKIE_PREFIX = "toybox_";

type LayoutPref<T> = { cookie: string; codec: CookieCodec<T>; default: T };

function pref<T>(name: string, codec: CookieCodec<T>, fallback: T): LayoutPref<T> {
  return { cookie: `${COOKIE_PREFIX}${name}`, codec, default: fallback };
}

export const LAYOUT_PREFS = {
  sidebarSize: pref("sidebar_size", numberCodec(clampSidebarSize), DEFAULT_SIDEBAR_SIZE),
  terminalSize: pref("terminal_size", numberCodec(clampTerminalSize), DEFAULT_TERMINAL_SIZE),
  sidebarOpen: pref("sidebar_open", booleanCodec, true),
  terminalOpen: pref("terminal_open", booleanCodec, false),
  automationsExpanded: pref("automations_expanded", booleanCodec, DEFAULT_AUTOMATIONS_EXPANDED),
  hyperOpen: pref("hyper_open", booleanCodec, false),
  hyperPosition: pref("hyper_pos", pointCodec, DEFAULT_HYPER_POSITION),
};

export type LayoutPrefKey = keyof typeof LAYOUT_PREFS;

// Value types derive from each codec (not the default), so a literal default like
// 15 doesn't narrow the pref type to `15`.
export type LayoutPrefs = {
  [K in LayoutPrefKey]: (typeof LAYOUT_PREFS)[K] extends LayoutPref<infer T> ? T : never;
};

const LAYOUT_PREF_KEYS = Object.keys(LAYOUT_PREFS) as LayoutPrefKey[];

// ── Read / resolve / write ────────────────────────────────────────────────────

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

export function buildLayoutCookie(name: string, value: string | number | boolean): string {
  return `${name}=${String(value)}; Path=/; Max-Age=${LAYOUT_COOKIE_MAX_AGE}; SameSite=Lax`;
}

// Serialize one pref to its full `Set-Cookie` string via the registry codec. Used
// by `useLayoutCookie` so a component persists a pref by name, not by wire format.
export function serializeLayoutCookie<K extends LayoutPrefKey>(
  key: K,
  value: LayoutPrefs[K],
): string {
  const { cookie, codec } = LAYOUT_PREFS[key];
  const serialize = (codec.serialize ?? String) as (value: LayoutPrefs[K]) => string;
  return buildLayoutCookie(cookie, serialize(value));
}
