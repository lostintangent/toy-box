import { describe, expect, test } from "bun:test";
import {
  buildLayoutCookie,
  DEFAULT_AUTOMATIONS_EXPANDED,
  DEFAULT_HYPER_POSITION,
  LAYOUT_COOKIE_MAX_AGE,
  LAYOUT_PREFS,
  parseLayoutPrefs,
  resolveLayoutPrefs,
  serializeLayoutCookie,
  SIDEBAR_MAX_SIZE,
} from "./layoutPrefs";

describe("layout prefs", () => {
  test("parses every layout cookie, including a single hyper position", () => {
    const cookieHeader = [
      `${LAYOUT_PREFS.sidebarSize.cookie}=18`,
      `${LAYOUT_PREFS.terminalSize.cookie}=42`,
      `${LAYOUT_PREFS.sidebarOpen.cookie}=false`,
      `${LAYOUT_PREFS.terminalOpen.cookie}=true`,
      `${LAYOUT_PREFS.automationsExpanded.cookie}=false`,
      `${LAYOUT_PREFS.hyperOpen.cookie}=true`,
      `${LAYOUT_PREFS.hyperPosition.cookie}=120,80`,
    ].join("; ");

    expect(parseLayoutPrefs(cookieHeader)).toEqual({
      sidebarSize: 18,
      terminalSize: 42,
      sidebarOpen: false,
      terminalOpen: true,
      automationsExpanded: false,
      hyperOpen: true,
      hyperPosition: { x: 120, y: 80 },
    });
  });

  test("defaults layout preferences when cookies are missing", () => {
    const resolved = resolveLayoutPrefs({});
    expect(resolved.automationsExpanded).toBe(DEFAULT_AUTOMATIONS_EXPANDED);
    expect(resolved.hyperOpen).toBe(false);
    expect(resolved.hyperPosition).toEqual(DEFAULT_HYPER_POSITION);
  });

  test("preserves explicit automations expanded preference", () => {
    const resolved = resolveLayoutPrefs({ automationsExpanded: false });
    expect(resolved.automationsExpanded).toBe(false);
  });

  test("clamps out-of-range sizes on read", () => {
    const cookieHeader = `${LAYOUT_PREFS.sidebarSize.cookie}=999`;
    expect(parseLayoutPrefs(cookieHeader).sidebarSize).toBe(SIDEBAR_MAX_SIZE);
  });

  test("ignores a malformed hyper position cookie", () => {
    const cookieHeader = `${LAYOUT_PREFS.hyperPosition.cookie}=nope`;
    expect(parseLayoutPrefs(cookieHeader).hyperPosition).toBeUndefined();
  });

  test("serializes a pref to its cookie via the registry codec", () => {
    const cookie = serializeLayoutCookie("hyperPosition", { x: 120, y: 80 });
    expect(cookie).toContain(`${LAYOUT_PREFS.hyperPosition.cookie}=120,80`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${LAYOUT_COOKIE_MAX_AGE}`);
    expect(cookie).toContain("SameSite=Lax");
  });

  test("builds a layout cookie string with standard attributes", () => {
    const cookie = buildLayoutCookie(LAYOUT_PREFS.automationsExpanded.cookie, false);
    expect(cookie).toContain(`${LAYOUT_PREFS.automationsExpanded.cookie}=false`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${LAYOUT_COOKIE_MAX_AGE}`);
    expect(cookie).toContain("SameSite=Lax");
  });
});
