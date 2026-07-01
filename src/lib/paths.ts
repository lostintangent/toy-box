export function getPathBasename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

export function getPathDirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSeparator <= 0) return ".";

  return normalized.slice(0, lastSeparator);
}

/**
 * Convert absolute path to relative path with ~ for home directory.
 * TODO: Have the server provide the home directory to avoid regex patterns.
 */
export function toRelativePath(absolutePath: string, cwd?: string): string {
  if (cwd) {
    const normalizedCwd = cwd.endsWith("/") ? cwd : `${cwd}/`;
    if (absolutePath.startsWith(normalizedCwd)) {
      return absolutePath.slice(normalizedCwd.length);
    }
    if (absolutePath === cwd) {
      return ".";
    }
  }

  const homePatterns = [/^\/Users\/[^/]+\//, /^\/home\/[^/]+\//, /^C:\\Users\\[^\\]+\\/i];

  for (const pattern of homePatterns) {
    if (pattern.test(absolutePath)) {
      return absolutePath.replace(pattern, "~/");
    }
  }

  return absolutePath;
}
