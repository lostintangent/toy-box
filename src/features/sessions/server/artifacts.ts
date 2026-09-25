import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { resolveSessionArtifactPath, sessionArtifactDirectory } from "@files/server/paths";
import type { SessionArtifact } from "../model";
import { SESSION_ARTIFACT_EXTENSIONS } from "../model/constants";

export function sessionArtifactsDirectory(sessionId: string): string {
  const path = sessionArtifactDirectory(sessionId);
  if (!path) throw new Error("Invalid session ID.");
  return path;
}

export async function ensureSessionFiles(sessionId: string): Promise<void> {
  await mkdir(sessionArtifactsDirectory(sessionId), { recursive: true });
}

export async function writeSessionArtifact(
  sessionId: string,
  path: string,
  content: string,
): Promise<void> {
  const target = resolveSessionArtifactPath(sessionId, path);
  if (!target) throw new Error("Invalid session artifact path.");
  await Bun.write(target, content);
}

/** Artifacts in stable path order, each with its last modification time. */
export async function listSessionArtifacts(sessionId: string): Promise<SessionArtifact[]> {
  const paths: string[] = [];
  const directory = sessionArtifactsDirectory(sessionId);
  try {
    for await (const path of new Bun.Glob("**/*").scan({
      cwd: directory,
      onlyFiles: true,
      throwErrorOnBrokenSymlink: false,
    })) {
      if (SESSION_ARTIFACT_EXTENSIONS.includes(extname(path).toLowerCase())) paths.push(path);
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  const artifacts = await Promise.all(
    paths.sort().map(async (path) => {
      // A file can disappear between the scan and its stat.
      const stats = await stat(join(directory, path)).catch((error: unknown) => {
        if (isMissingFileError(error)) return undefined;
        throw error;
      });
      return stats && { path, updatedAt: Math.trunc(stats.mtimeMs) };
    }),
  );
  return artifacts.filter((artifact) => artifact !== undefined);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function deleteSessionFiles(sessionId: string): Promise<void> {
  // Native history belongs to the provider; this directory contains only owned resources.
  await rm(dirname(sessionArtifactsDirectory(sessionId)), { recursive: true, force: true });
}
