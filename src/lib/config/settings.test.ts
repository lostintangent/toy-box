import { describe, expect, onTestFinished, test } from "bun:test";
import { createStore } from "jotai";
import {
  autoFocusArtifactsAtom,
  matchesSessionFeatureScope,
  normalizeSettings,
  showExternalSessionsAtom,
  terminalShellAtom,
  worktreeAtom,
} from "./settings";

describe("settings normalization", () => {
  test("preserves valid settings", () => {
    expect(
      normalizeSettings({
        terminalShell: "/bin/zsh",
        useWorktree: true,
        autoFocusArtifacts: "sessions",
        showExternalSessions: false,
      }),
    ).toEqual({
      terminalShell: "/bin/zsh",
      useWorktree: true,
      autoFocusArtifacts: "sessions",
      showExternalSessions: false,
    });
  });

  test("treats invalid persisted values like missing settings", () => {
    const missingSettings = normalizeSettings({});

    expect(
      normalizeSettings({
        terminalShell: 42,
        useWorktree: "yes",
        autoFocusArtifacts: "occasionally",
        showExternalSessions: "sometimes",
      }),
    ).toEqual(missingSettings);
  });

  test("setting atoms update one field without notifying the others", () => {
    const store = createStore();
    let worktreeUpdates = 0;
    onTestFinished(store.sub(worktreeAtom, () => worktreeUpdates++));

    store.set(terminalShellAtom, "/bin/zsh");
    expect(store.get(terminalShellAtom)).toBe("/bin/zsh");
    expect(worktreeUpdates).toBe(0);

    store.set(worktreeAtom, true);
    store.set(autoFocusArtifactsAtom, "sessions");
    store.set(showExternalSessionsAtom, false);
    expect(store.get(worktreeAtom)).toBe(true);
    expect(store.get(autoFocusArtifactsAtom)).toBe("sessions");
    expect(store.get(showExternalSessionsAtom)).toBe(false);
    expect(worktreeUpdates).toBe(1);
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
