import { encodeFileRoute, type WorkspaceFile } from ".";

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

/** The concise workspace label for a file path. */
export function fileName(path: string): string {
  const basename = getPathBasename(path);
  return basename === "plan.md" ? "Plan" : basename;
}

/** Collapse an absolute path beneath the working directory or a conventional home directory. */
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

/** Build a route URL for a workspace file. */
export function createFileRouteUrl(routePrefix: string, file: WorkspaceFile): string {
  const { scope, path } = encodeFileRoute(file);
  return `${routePrefix}/${encodeURIComponent(scope)}/${encodeFilePath(path.replaceAll("\\", "/"))}`;
}

/** Build a trailing-slash route base URL for resolving sibling file embeds. */
export function createFileRouteBaseUrl(routePrefix: string, file: WorkspaceFile): string {
  const { scope, path } = encodeFileRoute(file);
  const directory = getPathDirname(path.replaceAll("\\", "/"));
  const encodedDirectory = directory === "." ? "" : `${encodeFilePath(directory)}/`;

  return `${routePrefix}/${encodeURIComponent(scope)}/${encodedDirectory}`;
}

function encodeFilePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
