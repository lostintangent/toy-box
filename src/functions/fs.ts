// Server functions for filesystem access

import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

export type DirectoryEntry = {
  name: string;
  path: string;
};

export type ListDirectoryContentsResult =
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

const listDirectoryContentsInputSchema = z.object({
  path: z.string().optional(),
  showHidden: z.boolean().optional(),
});

/** List child directories at a given path (defaults to CWD) */
export const listDirectoryContents = createServerFn({ method: "GET" })
  .inputValidator(zodValidator(listDirectoryContentsInputSchema))
  .handler(async ({ data }): Promise<ListDirectoryContentsResult> => {
    const targetPath = resolve(data.path ?? process.cwd());

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
