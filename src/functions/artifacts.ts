// Server functions for reading and writing session artifacts.
//
// Every artifact lives under a session's persisted state directory. Both handlers
// resolve the caller-supplied path through the sandbox first, so an artifact can
// only ever be read or written inside its own session's folder. Node I/O errors
// (missing file, not a file, permission denied) propagate to the client, which
// shows its own message based on the operation it attempted.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { resolveSessionArtifactPath } from "@/lib/server/sandbox";

const readArtifactInputSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

const writeArtifactInputSchema = readArtifactInputSchema.extend({
  content: z.string(),
});

/** Read a UTF-8 artifact from a session's state directory. */
export const readSessionArtifact = createServerFn({ method: "GET" })
  .validator(zodValidator(readArtifactInputSchema))
  .handler(async ({ data }): Promise<{ content: string; timestamp: number }> => {
    const target = confineArtifactPath(data.sessionId, data.path);
    const { readFile, stat } = await import("node:fs/promises");
    const [content, info] = await Promise.all([readFile(target, "utf-8"), stat(target)]);
    return { content, timestamp: info.mtimeMs };
  });

/** Write a UTF-8 artifact into a session's state directory. */
export const writeSessionArtifact = createServerFn({ method: "POST" })
  .validator(zodValidator(writeArtifactInputSchema))
  .handler(async ({ data }): Promise<{ timestamp: number }> => {
    const target = confineArtifactPath(data.sessionId, data.path);
    const { stat, writeFile } = await import("node:fs/promises");
    await writeFile(target, data.content, "utf-8");
    return { timestamp: (await stat(target)).mtimeMs };
  });

/** Stat an artifact without reading its body — for preview kinds that render out-of-band. */
export const statSessionArtifact = createServerFn({ method: "GET" })
  .validator(zodValidator(readArtifactInputSchema))
  .handler(async ({ data }): Promise<{ timestamp: number }> => {
    const target = confineArtifactPath(data.sessionId, data.path);
    const { stat } = await import("node:fs/promises");
    return { timestamp: (await stat(target)).mtimeMs };
  });

function confineArtifactPath(sessionId: string, path: string): string {
  const target = resolveSessionArtifactPath(sessionId, path);
  if (!target) throw new Error("Invalid artifact path.");
  return target;
}
