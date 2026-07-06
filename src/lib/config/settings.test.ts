import { describe, expect, test } from "bun:test";
import { matchesSessionFeatureScope, normalizeSettings } from "./settings";

describe("settings normalization", () => {
  test("preserves valid settings", () => {
    expect(
      normalizeSettings({
        terminalShell: "/bin/zsh",
        useWorktree: true,
        showSessionOverlay: "automations",
        autoFocusArtifacts: "sessions",
      }),
    ).toEqual({
      terminalShell: "/bin/zsh",
      useWorktree: true,
      showSessionOverlay: "automations",
      autoFocusArtifacts: "sessions",
    });
  });

  test("falls back for invalid persisted values", () => {
    expect(
      normalizeSettings({
        terminalShell: 42,
        useWorktree: "yes",
        showSessionOverlay: "sometimes",
        autoFocusArtifacts: "occasionally",
      }),
    ).toEqual({
      terminalShell: "",
      useWorktree: false,
      showSessionOverlay: "sessions",
      autoFocusArtifacts: "automations",
    });
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
