import { describe, expect, test } from "bun:test";
import {
  AUTOMATIONS_EXPANDED_COOKIE,
  buildLayoutCookie,
  DEFAULT_AUTOMATIONS_EXPANDED,
  LAYOUT_COOKIE_MAX_AGE,
  SIDEBAR_OPEN_COOKIE,
  SIDEBAR_SIZE_COOKIE,
  TERMINAL_OPEN_COOKIE,
  TERMINAL_SIZE_COOKIE,
  parseLayoutPrefs,
  resolveLayoutPrefs,
} from "./layoutPrefs";

describe("layout prefs", () => {
  test("parses layout cookies including automations expanded state", () => {
    const cookieHeader = [
      `${SIDEBAR_SIZE_COOKIE}=18`,
      `${TERMINAL_SIZE_COOKIE}=42`,
      `${SIDEBAR_OPEN_COOKIE}=false`,
      `${TERMINAL_OPEN_COOKIE}=true`,
      `${AUTOMATIONS_EXPANDED_COOKIE}=false`,
    ].join("; ");

    expect(parseLayoutPrefs(cookieHeader)).toEqual({
      sidebarSize: 18,
      terminalSize: 42,
      sidebarOpen: false,
      terminalOpen: true,
      automationsExpanded: false,
    });
  });

  test("defaults automations expanded when the cookie is missing", () => {
    const resolved = resolveLayoutPrefs({});
    expect(resolved.automationsExpanded).toBe(DEFAULT_AUTOMATIONS_EXPANDED);
  });

  test("preserves explicit automations expanded preference", () => {
    const resolved = resolveLayoutPrefs({ automationsExpanded: false });
    expect(resolved.automationsExpanded).toBe(false);
  });

  test("builds layout cookie string with standard attributes", () => {
    const cookie = buildLayoutCookie(AUTOMATIONS_EXPANDED_COOKIE, false);
    expect(cookie).toContain(`${AUTOMATIONS_EXPANDED_COOKIE}=false`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${LAYOUT_COOKIE_MAX_AGE}`);
    expect(cookie).toContain("SameSite=Lax");
  });
});
