// A workspace file is one address for a file surfaced in the workspace: an
// artifact under a session's files directory, or a real file on the host machine.

import { z } from "zod";
import type { WorkspaceFile, Worker } from "@/types";

/** Stable identity for a workspace file: pane id, worker queue key, and notification coalesce key. */
export function workspaceFileId(file: WorkspaceFile): string {
  return file.type === "session"
    ? `session:${file.sessionId}:${file.path}`
    : `machine:${file.path}`;
}

export const workspaceFileSchema: z.ZodType<WorkspaceFile> = z.union([
  z.object({ type: z.literal("session"), sessionId: z.string().min(1), path: z.string().min(1) }),
  z.object({ type: z.literal("machine"), path: z.string().min(1) }),
]);

/** The session that owns a file, for edit notifications and default-mode policy. */
export function ownerSessionId(file: WorkspaceFile): string | undefined {
  return file.type === "session" ? file.sessionId : undefined;
}

/** Whether a worker belongs to a session — its own session, or the one that owns its file. */
export function isWorkerOwnedBySession(worker: Worker, sessionId: string): boolean {
  return (
    worker.sessionId === sessionId ||
    (worker.file !== undefined && ownerSessionId(worker.file) === sessionId)
  );
}

/** Split a file into its route scope segment and relative splat. Session URLs stay bare. */
export function encodeFileRoute(file: WorkspaceFile): { scope: string; path: string } {
  return file.type === "session"
    ? { scope: file.sessionId, path: file.path }
    : { scope: "machine", path: file.path.replace(/^\/+/, "") };
}

/** Reconstruct a file from a route scope segment and splat (the inverse of encodeFileRoute). */
export function decodeFileRoute(scope: string, path: string): WorkspaceFile {
  return scope === "machine" ? { type: "machine", path: `/${path}` } : sessionFile(scope, path);
}

/** A session file (an artifact): a path beneath a session's own files directory. */
export function sessionFile(sessionId: string, path: string): WorkspaceFile {
  return { type: "session", sessionId, path };
}

/** A machine file: a real file on the host, addressed by its absolute path. */
export function machineFile(path: string): WorkspaceFile {
  return { type: "machine", path };
}
