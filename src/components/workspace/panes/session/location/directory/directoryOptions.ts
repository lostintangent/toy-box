// Normalizes recent session directories into stable picker options.

export type SessionDirectoryOption = {
  cwd: string;
  repository?: string;
  gitRoot?: string;
};

export function normalizeSessionDirectoryOptions(
  options: SessionDirectoryOption[],
  fallback?: SessionDirectoryOption,
): SessionDirectoryOption[] {
  const unique = new Map<string, SessionDirectoryOption>();

  for (const option of options) {
    const cwd = option.cwd.trim();
    if (!cwd) continue;

    const existing = unique.get(cwd) ?? { cwd };
    unique.set(cwd, {
      cwd,
      repository: existing.repository ?? option.repository,
      gitRoot: existing.gitRoot ?? option.gitRoot,
    });
  }

  const fallbackCwd = fallback?.cwd?.trim();
  if (fallbackCwd && !unique.has(fallbackCwd)) {
    unique.set(fallbackCwd, {
      cwd: fallbackCwd,
      repository: fallback?.repository,
      gitRoot: fallback?.gitRoot,
    });
  }

  return Array.from(unique.values());
}

export function findSessionDirectoryOption(
  options: SessionDirectoryOption[],
  cwd?: string,
): SessionDirectoryOption | undefined {
  if (!cwd) return undefined;
  return options.find((option) => option.cwd === cwd);
}
