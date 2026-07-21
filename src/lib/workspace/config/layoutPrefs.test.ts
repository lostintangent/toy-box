import { describe, expect, test } from "bun:test";
import { parseLayoutPrefs, resolveLayoutPrefs, serializeLayoutCookie } from "./layoutPrefs";

describe("layout prefs", () => {
  test("parses every layout cookie, including a single hyper position", () => {
    const cookieHeader = [
      "toybox_sidebar_size=18",
      "toybox_terminal_size=42",
      "toybox_sidebar_open=false",
      "toybox_terminal_open=true",
      "toybox_automations_expanded=false",
      "toybox_hyper_open=true",
      "toybox_hyper_pos=120,80",
      "toybox_mobile_inbox_open=true",
    ].join("; ");

    expect(parseLayoutPrefs(cookieHeader)).toEqual({
      sidebarSize: 18,
      terminalSize: 42,
      sidebarOpen: false,
      terminalOpen: true,
      automationsExpanded: false,
      hyperOpen: true,
      hyperPosition: { x: 120, y: 80 },
      mobileInboxOpen: true,
    });
  });

  test("defaults layout preferences when cookies are missing", () => {
    const resolved = resolveLayoutPrefs({});
    expect(resolved.automationsExpanded).toBe(true);
    expect(resolved.hyperOpen).toBe(false);
    expect(resolved.hyperPosition).toEqual({ x: 24, y: 24 });
    expect(resolved.mobileInboxOpen).toBe(false);
  });

  test("preserves explicit automations expanded preference", () => {
    const resolved = resolveLayoutPrefs({ automationsExpanded: false });
    expect(resolved.automationsExpanded).toBe(false);
  });

  test("clamps out-of-range sizes on read", () => {
    expect(parseLayoutPrefs("toybox_sidebar_size=999").sidebarSize).toBe(40);
  });

  test("ignores a malformed hyper position cookie", () => {
    expect(parseLayoutPrefs("toybox_hyper_pos=nope").hyperPosition).toBeUndefined();
  });

  test("serializes a pref to its cookie via the registry codec", () => {
    const cookie = serializeLayoutCookie("hyperPosition", { x: 120, y: 80 });
    expect(cookie).toContain("toybox_hyper_pos=120,80");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("SameSite=Lax");
  });
});
