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

    const existing = unique.get(cwd);
    if (!existing) {
      unique.set(cwd, {
        cwd,
        repository: option.repository,
        gitRoot: option.gitRoot,
      });
      continue;
    }

    if (!existing.repository && option.repository) {
      unique.set(cwd, {
        ...existing,
        repository: option.repository,
      });
    }
    if (!existing.gitRoot && option.gitRoot) {
      const updated = unique.get(cwd);
      if (!updated) continue;
      unique.set(cwd, {
        cwd: updated.cwd,
        repository: updated.repository,
        gitRoot: option.gitRoot,
      });
    }
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
