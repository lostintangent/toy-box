import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { SESSION_STATE_PATH } from "@/lib/paths";

const SESSION_FILES_DIRECTORY = "files";

/** Resolve a domain-relative artifact path under a session's files directory. */
export function resolveSessionArtifactPath(sessionId: string, artifactPath: string): string | null {
  const sessionRoot = resolveSessionRoot(sessionId);
  if (!sessionRoot) return null;

  const filesRoot = resolve(sessionRoot, SESSION_FILES_DIRECTORY);
  const relativePath = artifactPath.trim();
  if (!relativePath) return null;
  if (
    isAbsolute(relativePath) ||
    relativePath.startsWith("~/") ||
    isSessionStateRelativePath(relativePath)
  ) {
    return null;
  }

  const absolutePath = resolve(filesRoot, relativePath);
  if (!isPathInsideRoot(filesRoot, absolutePath)) return null;

  return absolutePath;
}

/** Convert an SDK file path into the session artifact path the reducer stores. */
export function projectSessionArtifactPath(
  sessionId: string,
  path: string | undefined,
): string | undefined {
  const absolutePath = resolveSdkSessionStatePath(path);
  if (!absolutePath) return undefined;

  const sessionRoot = resolveSessionRoot(sessionId);
  if (!sessionRoot) return undefined;

  const filesRoot = resolve(sessionRoot, SESSION_FILES_DIRECTORY);
  return isPathInsideRoot(filesRoot, absolutePath)
    ? relativeArtifactPath(filesRoot, absolutePath)
    : undefined;
}

function getSessionStateRoot(): string {
  return resolve(homedir(), SESSION_STATE_PATH);
}

function resolveSessionRoot(sessionId: string): string | null {
  const sessionStateRoot = getSessionStateRoot();
  const sessionRoot = resolve(sessionStateRoot, sessionId);
  return isPathInsideRoot(sessionStateRoot, sessionRoot) ? sessionRoot : null;
}

function resolveSdkSessionStatePath(path: string | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;

  let absolutePath = trimmed;
  if (isSessionStateRelativePath(trimmed)) {
    absolutePath = resolve(homedir(), trimmed);
  } else if (trimmed.startsWith("~/")) {
    absolutePath = resolve(homedir(), trimmed.slice(2));
  }
  if (!isAbsolute(absolutePath)) return null;

  return isPathInsideRoot(getSessionStateRoot(), absolutePath) ? absolutePath : null;
}

function isSessionStateRelativePath(path: string): boolean {
  return path === SESSION_STATE_PATH || path.startsWith(`${SESSION_STATE_PATH}/`);
}

function relativeArtifactPath(filesRoot: string, absolutePath: string): string {
  return relative(filesRoot, absolutePath).split(sep).join("/");
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);

  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
