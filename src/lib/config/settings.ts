// Centralized application settings.
//
// Persisted as a single JSON blob in localStorage. Each setting saves
// independently via updateSetting() - no save button needed.

export type Settings = {
  terminalShell: string;
  useWorktree: boolean;
};

const STORAGE_KEY = "toybox_settings";

const DEFAULTS: Settings = {
  terminalShell: "",
  useWorktree: false,
};

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (typeof window === "undefined") return;

  try {
    const current = getSettings();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, [key]: value }));
  } catch {
    // Ignore storage errors
  }
}
