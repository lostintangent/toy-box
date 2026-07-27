// RPC boundary for reading and writing workspace files.
// A file is addressed by its WorkspaceFile — a session artifact or a machine path.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { resolveWorkspaceFile } from "@/lib/server/filePaths";
import { workspaceFileSchema } from "@/lib/files/workspaceFile";
import type { WorkspaceFile } from "@/types";

const fileInputSchema = z.object({ file: workspaceFileSchema });

const writeFileInputSchema = fileInputSchema.extend({
  content: z.string(),
});

export const readFile = createServerFn({ method: "GET" })
  .validator(zodValidator(fileInputSchema))
  .handler(async ({ data }): Promise<{ content: string; timestamp: number }> => {
    const absolutePath = requireFilePath(data.file);
    const { readFile: readFromDisk, stat } = await import("node:fs/promises");
    const [content, info] = await Promise.all([
      readFromDisk(absolutePath, "utf-8"),
      stat(absolutePath),
    ]);
    return { content, timestamp: info.mtimeMs };
  });

export const writeFile = createServerFn({ method: "POST" })
  .validator(zodValidator(writeFileInputSchema))
  .handler(async ({ data }): Promise<{ timestamp: number }> => {
    const absolutePath = requireFilePath(data.file);
    const { stat, writeFile: writeToDisk } = await import("node:fs/promises");
    await writeToDisk(absolutePath, data.content, "utf-8");
    return { timestamp: (await stat(absolutePath)).mtimeMs };
  });

function requireFilePath(file: WorkspaceFile): string {
  const target = resolveWorkspaceFile(file);
  if (!target) throw new Error("Invalid file path.");
  return target;
}
