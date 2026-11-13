import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Settings } from "@workspace/model/config/settings";
import {
  areSettingsEqual,
  matchesSessionFeatureScope,
  normalizeSettings,
  settingsSchema,
  settingsUpdateSchema,
} from "./settings";

describe("settings", () => {
  test("preserves valid settings", () => {
    const settings: Settings = {
      accentColor: "#123abc",
      defaultModel: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
      defaultSessionView: "responses",
      terminalShell: "/bin/zsh",
      useWorktree: true,
      autoFocusArtifacts: "sessions",
      disabledProviders: ["claude"],
      pinnedSessionIds: ["session-a", "session-b"],
      hyperSessionId: "session-c",
      serverName: "Studio",
      serverId: "6f1c2a4e-0b7d-4c3a-9e58-2d41f0a7b9c3",
      serverLinks: ["https://studio.ts.net", "http://127.0.0.1:3100"],
    };

    expect(normalizeSettings(settings)).toEqual(settings);
    expect(settingsSchema.safeParse(settings).success).toBe(true);
  });

  test("canonicalizes pinned session IDs as a set", () => {
    expect(
      normalizeSettings({ pinnedSessionIds: ["session-b", "session-a", "session-b"] }),
    ).toMatchObject({
      pinnedSessionIds: ["session-a", "session-b"],
    });
  });

  test("defaults invalid persisted fields independently", () => {
    const defaults = normalizeSettings({});

    expect(
      normalizeSettings({
        accentColor: "yellow",
        defaultModel: { name: "" },
        defaultSessionView: "quiet",
        terminalShell: 42,
        useWorktree: "yes",
        autoFocusArtifacts: "occasionally",
        pinnedSessionIds: [42],
      }),
    ).toEqual(defaults);
  });

  test("provider enablement defaults Claude off and preserves an explicitly empty set", () => {
    expect(normalizeSettings({}).disabledProviders).toEqual(["claude"]);
    expect(normalizeSettings({ disabledProviders: [] }).disabledProviders).toEqual([]);
    const settings = normalizeSettings({ disabledProviders: ["copilot", "claude", "copilot"] });
    expect(settings.disabledProviders).toEqual(["claude", "copilot"]);
    expect(
      areSettingsEqual(settings, { ...settings, disabledProviders: ["copilot", "claude"] }),
    ).toBe(true);
    expect(areSettingsEqual(settings, { ...settings, disabledProviders: [] })).toBe(false);
  });

  test("the session view defaults to all and validates both choices for updates", () => {
    expect(normalizeSettings({}).defaultSessionView).toBe("all");
    expect(settingsUpdateSchema.safeParse({ defaultSessionView: "all" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ defaultSessionView: "responses" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ defaultSessionView: "quiet" }).success).toBe(false);
  });

  test("an update can't change the server's id or links, which only the server and linking write", () => {
    const update = {
      serverName: "Studio",
      serverId: "other",
      serverLinks: ["https://studio.ts.net"],
    };
    expect(settingsUpdateSchema.parse(update)).toEqual({ serverName: "Studio" });
  });

  test("an update trims the server's name and refuses one over 64 characters", () => {
    expect(settingsUpdateSchema.parse({ serverName: "  Studio  " })).toEqual({
      serverName: "Studio",
    });
    expect(settingsUpdateSchema.parse({ serverName: "   " })).toEqual({ serverName: "" });
    expect(settingsUpdateSchema.safeParse({ serverName: "x".repeat(65) }).success).toBe(false);
  });

  test("validates complete settings at the transport boundary", () => {
    expect(settingsSchema.safeParse({}).success).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...normalizeSettings({}),
        accentColor: "yellow",
      }).success,
    ).toBe(false);
  });

  test("describes precise settings updates as JSON Schema", () => {
    expect(
      settingsUpdateSchema.safeParse({
        accentColor: "#FACC15",
        terminalShell: "/bin/fish",
        pinnedSessionIds: ["session-a"],
      }).success,
    ).toBe(true);
    expect(settingsUpdateSchema.safeParse({ accentColor: "#fff" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ pinnedSessionIds: [42] }).success).toBe(false);
    const jsonSchema = z.toJSONSchema(settingsUpdateSchema);
    expect(jsonSchema).toMatchObject({
      properties: {
        accentColor: {
          type: "string",
          pattern: "^#[0-9a-fA-F]{6}$",
        },
        pinnedSessionIds: {
          type: "array",
          items: { type: "string" },
        },
      },
    });
    expect("required" in jsonSchema).toBe(false);
  });

  test("compares settings by their domain fields", () => {
    const settings = {
      ...normalizeSettings({}),
      defaultModel: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
      pinnedSessionIds: ["session-a"],
    };
    expect(
      areSettingsEqual(settings, {
        ...settings,
        defaultModel: { ...settings.defaultModel },
        pinnedSessionIds: ["session-a", "session-a"],
      }),
    ).toBe(true);
    expect(areSettingsEqual(settings, { ...settings, useWorktree: true })).toBe(false);
    expect(
      areSettingsEqual(settings, {
        ...settings,
        pinnedSessionIds: ["session-b"],
      }),
    ).toBe(false);
    expect(
      areSettingsEqual(settings, {
        ...settings,
        defaultModel: { ...settings.defaultModel, reasoningEffort: "low" },
      }),
    ).toBe(false);
  });
});

describe("session feature scope matching", () => {
  test.each([
    ["always", true, true],
    ["sessions", true, false],
    ["automations", false, true],
    ["never", false, false],
  ] as const)(
    "%s matches the expected session and automation subjects",
    (scope, matchesSession, matchesAutomation) => {
      expect(matchesSessionFeatureScope(scope, "session")).toBe(matchesSession);
      expect(matchesSessionFeatureScope(scope, "automation")).toBe(matchesAutomation);
    },
  );
});
