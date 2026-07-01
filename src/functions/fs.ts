// Server functions for filesystem access.
//
// General-purpose, unconfined filesystem access is limited to listing directories
// (used by the directory picker). Reading and writing files is exposed only through
// the sandboxed session-artifact functions in `./artifacts`.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

export type DirectoryEntry = {
  name: string;
  path: string;
};

export type ListDirectoryResult =
  | {
      status: "ok";
      currentPath: string;
      parentPath: string | null;
      directories: DirectoryEntry[];
    }
  | {
      status: "error";
      message: string;
    };

const listDirectoryInputSchema = z.object({
  path: z.string().optional(),
  showHidden: z.boolean().optional(),
});

/** List child directories at a given path (defaults to CWD). */
export const listDirectory = createServerFn({ method: "GET" })
  .validator(zodValidator(listDirectoryInputSchema))
  .handler(async ({ data }): Promise<ListDirectoryResult> => {
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

    try {
      const info = await stat(targetPath);
      if (!info.isDirectory()) {
        return { status: "error", message: "Path is not a directory." };
      }

      const entries = await readdir(targetPath, { withFileTypes: true });
      const directories: DirectoryEntry[] = entries
        .filter((entry) => entry.isDirectory() && (data.showHidden || !entry.name.startsWith(".")))
        .map((entry) => ({ name: entry.name, path: resolve(targetPath, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parentPath = dirname(targetPath);
      return {
        status: "ok",
        currentPath: targetPath,
        parentPath: parentPath !== targetPath ? parentPath : null,
        directories,
      };
    } catch {
      return { status: "error", message: "Unable to read directory." };
    }
  });
