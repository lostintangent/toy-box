// Server functions for host filesystem navigation, backing the file browser and
// directory picker. File reads and writes go through the WorkspaceFile RPCs in
// `@/functions/files`.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

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

const listDirectoryInputSchema = z.object({
  path: z.string().optional(),
  showHidden: z.boolean().optional(),
});

/** List a directory's immediate subdirectories and files (defaults to CWD); throws if unreadable. */
export const listDirectory = createServerFn({ method: "GET" })
  .validator(zodValidator(listDirectoryInputSchema))
  .handler(async ({ data }): Promise<DirectoryListing> => {
    const [{ readdir, stat }, { homedir }, { dirname, resolve }] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
    ]);
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
