/**
 * Persists the user's preferred shell (e.g. zsh, fish) in localStorage
 * so it survives across sessions and page reloads.
 */

export const TERMINAL_SHELL_STORAGE_KEY = "toybox_terminal_shell";

export function getStoredTerminalShell(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(TERMINAL_SHELL_STORAGE_KEY);
    if (!stored) return null;
    const trimmed = stored.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
