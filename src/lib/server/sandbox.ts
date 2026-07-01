import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { SESSION_STATE_PATH } from "@/lib/session/sessionState";

/** Resolve an artifact path under a session's persisted state directory. */
export function resolveSessionArtifactPath(sessionId: string, artifactPath: string): string | null {
  const sessionRoot = resolveSessionRoot(sessionId);
  if (!sessionRoot) return null;

  return resolvePathInsideRoot(sessionRoot, artifactPath);
}

/** Return a session-state path reference when the input is inside session state. */
export function resolveSessionStatePath(path: string | undefined): string | undefined {
  const pathReference = normalizeSessionStatePathReference(path);
  if (!pathReference) return undefined;

  const absolutePath = resolveHomePath(pathReference);
  return isPathInsideRoot(getSessionStateRoot(), absolutePath) ? pathReference : undefined;
}

function getSessionStateRoot(): string {
  return resolve(homedir(), SESSION_STATE_PATH);
}

function resolveSessionRoot(sessionId: string): string | null {
  const sessionStateRoot = getSessionStateRoot();
  const sessionRoot = resolve(sessionStateRoot, sessionId);
  return isPathInsideRoot(sessionStateRoot, sessionRoot) ? sessionRoot : null;
}

function resolvePathInsideRoot(rootPath: string, path: string): string | null {
  const normalizedPath = normalizePathInput(path);
  if (!normalizedPath) return null;

  const targetPath = isAbsolute(normalizedPath)
    ? resolve(normalizedPath)
    : resolve(rootPath, normalizedPath);

  return isPathInsideRoot(rootPath, targetPath) ? targetPath : null;
}

function normalizeSessionStatePathReference(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;

  return isSessionStateRelativePath(trimmed) ? resolve(homedir(), trimmed) : trimmed;
}

function normalizePathInput(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  if (isSessionStateRelativePath(trimmed)) return resolve(homedir(), trimmed);

  return expandHomePath(trimmed, homedir());
}

function isSessionStateRelativePath(path: string): boolean {
  return path === SESSION_STATE_PATH || path.startsWith(`${SESSION_STATE_PATH}/`);
}

function resolveHomePath(path: string): string {
  return resolve(expandHomePath(path, homedir()));
}

function expandHomePath(path: string, homeDirectory: string): string {
  return path.startsWith("~/") ? resolve(homeDirectory, path.slice(2)) : path;
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
