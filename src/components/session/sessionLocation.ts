export type SessionLocationInput = {
  repository?: string;
  gitRoot?: string;
  cwd?: string;
};

export type SessionLocationDisplay = {
  kind: "repository" | "directory";
  label: string;
  tooltip: string;
  description: string;
};

function getFolderNameFromCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return cwd;

  const withoutTrailingSlash = trimmed.replace(/[\\/]+$/, "");
  if (!withoutTrailingSlash) {
    return trimmed;
  }

  const pathParts = withoutTrailingSlash.split(/[\\/]/).filter(Boolean);
  return pathParts[pathParts.length - 1] ?? withoutTrailingSlash;
}

function getRepoName(repository: string): string {
  const trimmed = repository.trim();
  if (!trimmed) return repository;

  const withoutGitSuffix = trimmed.replace(/\.git$/i, "");
  const withoutTrailingSlash = withoutGitSuffix.replace(/[\\/]+$/, "");
  const withoutScpPrefix =
    withoutTrailingSlash.includes("://") || !withoutTrailingSlash.includes(":")
      ? withoutTrailingSlash
      : withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf(":") + 1);
  const pathParts = withoutScpPrefix.split(/[\\/]/).filter(Boolean);
  return pathParts[pathParts.length - 1] ?? withoutScpPrefix;
}

export function resolveSessionLocation({
  repository,
  gitRoot,
  cwd,
}: SessionLocationInput): SessionLocationDisplay | null {
  if (repository) {
    return {
      kind: "repository",
      label: getRepoName(repository),
      tooltip: repository,
      description: `Repository: ${repository}`,
    };
  }

  if (gitRoot) {
    return {
      kind: "repository",
      label: getFolderNameFromCwd(gitRoot),
      tooltip: gitRoot,
      description: `Repository root: ${gitRoot}`,
    };
  }

  if (!cwd) return null;

  return {
    kind: "directory",
    label: getFolderNameFromCwd(cwd),
    tooltip: cwd,
    description: `Working directory: ${cwd}`,
  };
}
