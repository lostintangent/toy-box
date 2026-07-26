import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Settings } from "@/types";
import {
  areSettingsEqual,
  isAccentColor,
  matchesSessionFeatureScope,
  normalizeSettings,
  settingsSchema,
  settingsUpdateSchema,
} from "./settings";

describe("settings", () => {
  test("preserves valid settings", () => {
    const settings: Settings = {
      accentColor: "#123abc",
      defaultModel: { name: "gpt-5", reasoningEffort: "high" },
      terminalShell: "/bin/zsh",
      useWorktree: true,
      autoFocusArtifacts: "sessions",
      showExternalSessions: false,
      pinnedSessionIds: ["session-a", "session-b"],
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
        terminalShell: 42,
        useWorktree: "yes",
        autoFocusArtifacts: "occasionally",
        showExternalSessions: "sometimes",
        pinnedSessionIds: [42],
      }),
    ).toEqual(defaults);
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

  test("recognizes six-digit hex accent colors", () => {
    expect(isAccentColor("#facc15")).toBe(true);
    expect(isAccentColor("#FACC15")).toBe(true);
    expect(isAccentColor("#fff")).toBe(false);
    expect(isAccentColor("yellow")).toBe(false);
  });

  test("compares settings by their domain fields", () => {
    const settings = {
      ...normalizeSettings({}),
      defaultModel: { name: "gpt-5", reasoningEffort: "high" },
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
