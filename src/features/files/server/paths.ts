// Server-side resolution of a WorkspaceFile to an absolute path: a session
// artifact resolves under its sandboxed session artifacts directory; a machine file
// resolves to its own absolute path (single trusted owner, so no sandbox root).

import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { SESSION_STORAGE_PATH } from "@sessions/model/constants";
import { machineFile, sessionFile, type WorkspaceFile } from "../model";

const SESSION_ARTIFACTS_DIRECTORY = "artifacts";

/** Resolve a domain-relative artifact path under a session's artifacts directory. */
export function resolveSessionArtifactPath(sessionId: string, artifactPath: string): string | null {
  const filesRoot = sessionArtifactDirectory(sessionId);
  if (!filesRoot) return null;
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

/** Resolve any workspace file — a session artifact or a machine file — to an absolute path. */
export function resolveWorkspaceFile(file: WorkspaceFile): string | null {
  return file.kind === "session"
    ? resolveSessionArtifactPath(file.sessionId, file.path)
    : resolveMachineFilePath(file.path);
}

/** Preserve Session ownership when turning an absolute host path into a file address. */
export function workspaceFileFromAbsolutePath(path: string): WorkspaceFile {
  const absolutePath = resolve(path);
  const sessionStateRoot = resolve(homedir(), SESSION_STORAGE_PATH);
  if (isPathInsideRoot(sessionStateRoot, absolutePath)) {
    const [sessionId, directory, ...artifactPath] = relative(sessionStateRoot, absolutePath).split(
      sep,
    );
    if (sessionId && directory === SESSION_ARTIFACTS_DIRECTORY && artifactPath.length > 0) {
      return sessionFile(sessionId, artifactPath.join("/"));
    }
  }
  return machineFile(absolutePath);
}

/** A machine file resolves to its own absolute path. One trusted owner, so no sandbox root. */
function resolveMachineFilePath(path: string): string | null {
  return isAbsolute(path) ? resolve(path) : null;
}

/** Convert an SDK file path into the session artifact path the reducer stores. */
export function projectSessionArtifactPath(
  sessionId: string,
  path: string | undefined,
): string | undefined {
  const absolutePath = resolveSdkSessionStatePath(path);
  if (!absolutePath) return undefined;
  const file = workspaceFileFromAbsolutePath(absolutePath);
  return file.kind === "session" && file.sessionId === sessionId ? file.path : undefined;
}

/** Sessions owns one artifact location, independent of its provider. */
export function sessionArtifactDirectory(sessionId: string): string | null {
  if (
    !sessionId ||
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    sessionId === "." ||
    sessionId === ".."
  )
    return null;
  return resolve(homedir(), SESSION_STORAGE_PATH, sessionId, SESSION_ARTIFACTS_DIRECTORY);
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

  return isPathInsideRoot(resolve(homedir(), SESSION_STORAGE_PATH), absolutePath)
    ? absolutePath
    : null;
}

function isSessionStateRelativePath(path: string): boolean {
  return path === SESSION_STORAGE_PATH || path.startsWith(`${SESSION_STORAGE_PATH}/`);
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
