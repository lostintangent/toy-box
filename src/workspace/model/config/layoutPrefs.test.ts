import { describe, expect, test } from "bun:test";
import { readWorkspaceLayout, serializeWorkspaceLayout } from "./layoutPrefs";

const defaultLayout = {
  sidebarWidth: 280,
  terminalSize: 30,
  sidebarCollapsed: false,
  terminalOpen: false,
  panels: {},
  hyperOpen: false,
  hyperPosition: { x: 24, y: 24 },
};

function cookieFor(value: unknown): string {
  return `toybox_layout=${encodeURIComponent(JSON.stringify(value))}`;
}

function cookieValue(cookie: string): unknown {
  const value = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
  return JSON.parse(decodeURIComponent(value));
}

describe("workspace layout", () => {
  test("uses product defaults when no preferences are stored", () => {
    expect(readWorkspaceLayout()).toEqual(defaultLayout);
    expect(cookieValue(serializeWorkspaceLayout(defaultLayout))).toEqual({});
  });

  test("round-trips one cookie containing only non-default preferences", () => {
    const cookie = serializeWorkspaceLayout({
      ...defaultLayout,
      sidebarWidth: 320,
      terminalSize: 42,
      sidebarCollapsed: true,
      terminalOpen: true,
      panels: { channels: true },
      hyperOpen: true,
      hyperPosition: { x: 120, y: 80 },
    });

    expect(cookieValue(cookie)).toEqual({
      sidebarWidth: 320,
      terminalSize: 42,
      sidebarCollapsed: true,
      terminalOpen: true,
      panels: { channels: true },
      hyperOpen: true,
      hyperPosition: { x: 120, y: 80 },
    });
    expect(readWorkspaceLayout(`other=value; ${cookie}`)).toEqual({
      sidebarWidth: 320,
      terminalSize: 42,
      sidebarCollapsed: true,
      terminalOpen: true,
      panels: { channels: true },
      hyperOpen: true,
      hyperPosition: { x: 120, y: 80 },
    });
  });

  test("validates stored layout and clamps dimensions", () => {
    expect(readWorkspaceLayout(cookieFor({ sidebarWidth: 9999, terminalSize: 999 }))).toMatchObject(
      {
        sidebarWidth: 480,
        terminalSize: 80,
      },
    );
    expect(readWorkspaceLayout("toybox_layout=%")).toEqual(defaultLayout);
  });
});
