// Browser settings persist as one validated value. React consumers subscribe to
// one setting at a time; imperative boundaries can read the same storage directly.

import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

export type Settings = {
  terminalShell: string;
  useWorktree: boolean;
  autoFocusArtifacts: SessionFeatureScope;
  showExternalSessions: boolean;
};

const SESSION_FEATURE_SCOPE_VALUES = ["always", "sessions", "automations", "never"] as const;

export type SessionFeatureScope = (typeof SESSION_FEATURE_SCOPE_VALUES)[number];

export type SessionFeatureSubject = "session" | "automation";

const STORAGE_KEY = "toybox_settings";

export const DEFAULT_SETTINGS: Settings = {
  terminalShell: "",
  useWorktree: false,
  autoFocusArtifacts: "automations",
  showExternalSessions: true,
};

const settingsStorage = createJSONStorage<unknown>();
const storedSettingsAtom = atomWithStorage<unknown>(
  STORAGE_KEY,
  DEFAULT_SETTINGS,
  settingsStorage,
  { getOnInit: true },
);
const settingsAtom = atom(
  (get) => normalizeSettings(get(storedSettingsAtom)),
  (_get, set, settings: Settings) => set(storedSettingsAtom, settings),
);

export const terminalShellAtom = settingAtom("terminalShell");
export const worktreeAtom = settingAtom("useWorktree");
export const autoFocusArtifactsAtom = settingAtom("autoFocusArtifacts");
export const showExternalSessionsAtom = settingAtom("showExternalSessions");

export function getSettings(): Settings {
  return normalizeSettings(settingsStorage.getItem(STORAGE_KEY, DEFAULT_SETTINGS));
}

export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  return {
    terminalShell:
      typeof value.terminalShell === "string"
        ? value.terminalShell
        : DEFAULT_SETTINGS.terminalShell,
    useWorktree:
      typeof value.useWorktree === "boolean" ? value.useWorktree : DEFAULT_SETTINGS.useWorktree,
    autoFocusArtifacts: isSessionFeatureScope(value.autoFocusArtifacts)
      ? value.autoFocusArtifacts
      : DEFAULT_SETTINGS.autoFocusArtifacts,
    showExternalSessions:
      typeof value.showExternalSessions === "boolean"
        ? value.showExternalSessions
        : DEFAULT_SETTINGS.showExternalSessions,
  };
}

export function isSessionFeatureScope(value: unknown): value is SessionFeatureScope {
  return SESSION_FEATURE_SCOPE_VALUES.includes(value as SessionFeatureScope);
}

export function matchesSessionFeatureScope(
  scope: SessionFeatureScope,
  subject: SessionFeatureSubject,
): boolean {
  if (scope === "never") return false;
  if (scope === "always") return true;
  return (
    (scope === "sessions" && subject === "session") ||
    (scope === "automations" && subject === "automation")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function settingAtom<Key extends keyof Settings>(key: Key) {
  return atom(
    (get) => get(settingsAtom)[key],
    (get, set, value: Settings[Key]) => {
      const settings = get(settingsAtom);
      if (Object.is(settings[key], value)) return;
      set(settingsAtom, { ...settings, [key]: value });
    },
  );
}
