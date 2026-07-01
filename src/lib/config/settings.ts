// Centralized application settings.
//
// Persisted as a single JSON blob in localStorage. Each setting saves
// independently via updateSetting() - no save button needed.

export type Settings = {
  terminalShell: string;
  useWorktree: boolean;
  showSessionOverlay: SessionFeatureScope;
  autoFocusArtifacts: SessionFeatureScope;
};

export const SESSION_FEATURE_SCOPE_VALUES = ["always", "sessions", "automations", "never"] as const;

export type SessionFeatureScope = (typeof SESSION_FEATURE_SCOPE_VALUES)[number];

export type SessionFeatureSubject = "session" | "automation";

const STORAGE_KEY = "toybox_settings";
const SETTINGS_CHANGE_EVENT = "toybox:settings-change";

const DEFAULTS: Settings = {
  terminalShell: "",
  useWorktree: false,
  showSessionOverlay: "always",
  autoFocusArtifacts: "always",
};

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULTS;
  }
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (typeof window === "undefined") return;

  try {
    const current = getSettings();
    const next = normalizeSettings({ ...current, [key]: value });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
  } catch {
    // Ignore storage errors
  }
}

export function subscribeSettings(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleSettingsChange = () => listener();
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      listener();
    }
  };

  window.addEventListener(SETTINGS_CHANGE_EVENT, handleSettingsChange);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener(SETTINGS_CHANGE_EVENT, handleSettingsChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}

export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) return DEFAULTS;

  return {
    terminalShell:
      typeof value.terminalShell === "string" ? value.terminalShell : DEFAULTS.terminalShell,
    useWorktree: typeof value.useWorktree === "boolean" ? value.useWorktree : DEFAULTS.useWorktree,
    showSessionOverlay: isSessionFeatureScope(value.showSessionOverlay)
      ? value.showSessionOverlay
      : DEFAULTS.showSessionOverlay,
    autoFocusArtifacts: isSessionFeatureScope(value.autoFocusArtifacts)
      ? value.autoFocusArtifacts
      : DEFAULTS.autoFocusArtifacts,
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
