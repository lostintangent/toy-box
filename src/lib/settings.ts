// Centralized application settings.
//
// Persisted as a single JSON blob in localStorage. Each setting saves
// independently via updateSetting() — no save button needed.

export type Settings = {
  terminalShell: string;
  useWorktree: boolean;
};

const STORAGE_KEY = "toybox_settings";

const DEFAULTS: Settings = {
  terminalShell: "",
  useWorktree: false,
};

const LEGACY_TERMINAL_SHELL_KEY = "toybox_terminal_shell";

function migrateLegacySettings(): void {
  try {
    const legacyShell = window.localStorage.getItem(LEGACY_TERMINAL_SHELL_KEY);
    if (legacyShell === null) return;
    const trimmed = legacyShell.trim();
    if (trimmed.length > 0) {
      const current = window.localStorage.getItem(STORAGE_KEY);
      const parsed = current ? JSON.parse(current) : {};
      if (!parsed.terminalShell) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...parsed, terminalShell: trimmed }),
        );
      }
    }
    window.localStorage.removeItem(LEGACY_TERMINAL_SHELL_KEY);
  } catch {
    // Ignore migration errors
  }
}

let migrated = false;

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  if (!migrated) {
    migrated = true;
    migrateLegacySettings();
  }
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
