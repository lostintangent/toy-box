import { z } from "zod";

export * from "./editors";

// A workspace file is one address for a file surfaced in the workspace: an
// artifact under a session's files directory, or a real file on the host machine.

export const sessionFileSchema = z.object({
  type: z.literal("session"),
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

export const workspaceFileSchema = z.discriminatedUnion("type", [
  sessionFileSchema,
  z.object({ type: z.literal("machine"), path: z.string().min(1) }),
]);

export const workspaceFileInputSchema = z.object({ file: workspaceFileSchema });

export const writeFileInputSchema = workspaceFileInputSchema.extend({
  content: z.string(),
});

export const createFileInputSchema = z.object({
  directory: z.string().min(1),
  name: z.string().trim().min(1),
});

export const listDirectoryInputSchema = z.object({
  path: z.string().optional(),
  showHidden: z.boolean().optional(),
});

export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;
export type SessionFile = z.infer<typeof sessionFileSchema>;
export type CreateFileInput = z.infer<typeof createFileInputSchema>;
export type ListDirectoryInput = z.infer<typeof listDirectoryInputSchema>;
export type WorkspaceFileMode = "read" | "edit" | "shared";
export type FileWatchEvent = { type: "modified"; timestamp: number } | { type: "deleted" };

export type DirectoryEntry = {
  name: string;
  path: string;
};

/** A directory's immediate subdirectories and files. */
export type DirectoryListing = {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
  files: DirectoryEntry[];
};

/** Stable identity for a workspace file: pane id, worker ownership, and notification coalesce key. */
export function workspaceFileId(file: WorkspaceFile): string {
  return file.type === "session"
    ? `session:${file.sessionId}:${file.path}`
    : `machine:${file.path}`;
}

/** The session that owns a file, for edit notifications and default-mode policy. */
export function ownerSessionId(file: WorkspaceFile): string | undefined {
  return file.type === "session" ? file.sessionId : undefined;
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
export function sessionFile(sessionId: string, path: string): SessionFile {
  return { type: "session", sessionId, path };
}

/** A machine file: a real file on the host, addressed by its absolute path. */
export function machineFile(path: string): Extract<WorkspaceFile, { type: "machine" }> {
  return { type: "machine", path };
}
