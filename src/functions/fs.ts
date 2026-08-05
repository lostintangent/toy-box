// RPC boundary for browsing the host filesystem and creating, reading, or
// writing WorkspaceFiles.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { workspaceFileSchema } from "@/lib/files/workspaceFile";
import { resolveWorkspaceFile } from "@/lib/server/filePaths";
import type { WorkspaceFile } from "@/types";

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

const workspaceFileInputSchema = z.object({ file: workspaceFileSchema });

const writeFileInputSchema = workspaceFileInputSchema.extend({
  content: z.string(),
});

const createFileInputSchema = z.object({
  directory: z.string().min(1),
  name: z.string().trim().min(1),
});

const listDirectoryInputSchema = z.object({
  path: z.string().optional(),
  showHidden: z.boolean().optional(),
});

export const readFile = createServerFn({ method: "GET" })
  .validator(zodValidator(workspaceFileInputSchema))
  .handler(async ({ data }): Promise<{ content: string; timestamp: number }> => {
    const absolutePath = requireFilePath(data.file);
    const file = Bun.file(absolutePath);
    const [content, info] = await Promise.all([file.text(), file.stat()]);
    return { content, timestamp: info.mtimeMs };
  });

export const writeFile = createServerFn({ method: "POST" })
  .validator(zodValidator(writeFileInputSchema))
  .handler(async ({ data }): Promise<{ timestamp: number }> => {
    const absolutePath = requireFilePath(data.file);
    await Bun.write(absolutePath, data.content);
    return { timestamp: (await Bun.file(absolutePath).stat()).mtimeMs };
  });

/** Create one empty file without replacing an existing entry. */
export const createFile = createServerFn({ method: "POST" })
  .validator(zodValidator(createFileInputSchema))
  .handler(async ({ data }): Promise<{ path: string }> => {
    if (data.name === "." || data.name === ".." || basename(data.name) !== data.name) {
      throw new Error("File name must not contain a directory path.");
    }

    const path = resolve(data.directory, data.name);
    try {
      const file = await open(path, "wx");
      await file.close();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error(`A file named "${data.name}" already exists.`);
      }
      throw error;
    }
    return { path };
  });

/** List a directory's immediate subdirectories and files (defaults to CWD); throws if unreadable. */
export const listDirectory = createServerFn({ method: "GET" })
  .validator(zodValidator(listDirectoryInputSchema))
  .handler(async ({ data }): Promise<DirectoryListing> => {
    // Expand a leading ~ before resolving the requested directory (defaults to CWD).
    const requested = data.path ?? process.cwd();
    const targetPath =
      requested === "~"
        ? homedir()
        : requested.startsWith("~/")
          ? resolve(homedir(), requested.slice(2))
          : resolve(requested);

    if (!(await stat(targetPath)).isDirectory()) {
      throw new Error("Path is not a directory.");
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    const visible = (name: string) => data.showHidden || !name.startsWith(".");

    // Follow symlinks so a linked directory or file is classified by its target —
    // a symlink's own Dirent reports neither. Unresolved entries get a null kind
    // and are skipped when partitioning below.
    const classified = await Promise.all(
      entries
        .filter((entry) => visible(entry.name))
        .map(async (entry) => {
          const path = resolve(targetPath, entry.name);
          const target = entry.isSymbolicLink() ? await stat(path).catch(() => null) : entry;
          const kind = target?.isDirectory() ? "directory" : target?.isFile() ? "file" : null;
          return { name: entry.name, path, kind };
        }),
    );

    const directories: DirectoryEntry[] = [];
    const files: DirectoryEntry[] = [];
    for (const { name, path, kind } of classified) {
      if (kind === "directory") directories.push({ name, path });
      else if (kind === "file") files.push({ name, path });
    }

    const byName = (a: DirectoryEntry, b: DirectoryEntry) => a.name.localeCompare(b.name);
    directories.sort(byName);
    files.sort(byName);

    const parentPath = dirname(targetPath);
    return {
      currentPath: targetPath,
      parentPath: parentPath !== targetPath ? parentPath : null,
      directories,
      files,
    };
  });

function requireFilePath(file: WorkspaceFile): string {
  const target = resolveWorkspaceFile(file);
  if (!target) throw new Error("Invalid file path.");
  return target;
}
