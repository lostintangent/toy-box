// RPC boundary for reading, writing, and spawning background workers for artifacts.
// Every artifact is addressed by its source session and relative path.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  cancelArtifactWorker as cancelArtifactWorkerExecution,
  spawnArtifactWorker as executeArtifactWorker,
} from "@/functions/artifacts/workers";
import { resolveArtifactPath } from "@/functions/artifacts/paths";
import type { JsonValue } from "@/types";

const artifactInputSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

const writeArtifactInputSchema = artifactInputSchema.extend({
  content: z.string(),
});

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const artifactWorkerInputSchema = artifactInputSchema.extend({
  name: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(100_000),
  metadata: jsonValueSchema.optional(),
});

const cancelArtifactWorkerInputSchema = artifactInputSchema.extend({
  workerSessionId: z.string().min(1),
});

export type ArtifactWorkerInput = z.infer<typeof artifactWorkerInputSchema>;

export const readArtifact = createServerFn({ method: "GET" })
  .validator(zodValidator(artifactInputSchema))
  .handler(async ({ data }): Promise<{ content: string; timestamp: number }> => {
    const absolutePath = await requireArtifactPath(data.sessionId, data.path);
    const { readFile, stat } = await import("node:fs/promises");
    const [content, info] = await Promise.all([
      readFile(absolutePath, "utf-8"),
      stat(absolutePath),
    ]);
    return { content, timestamp: info.mtimeMs };
  });

export const writeArtifact = createServerFn({ method: "POST" })
  .validator(zodValidator(writeArtifactInputSchema))
  .handler(async ({ data }): Promise<{ timestamp: number }> => {
    const absolutePath = await requireArtifactPath(data.sessionId, data.path);
    const { stat, writeFile } = await import("node:fs/promises");
    await writeFile(absolutePath, data.content, "utf-8");
    return { timestamp: (await stat(absolutePath)).mtimeMs };
  });

/** Spawn a worker with renderer-authored instructions for this artifact. */
export const spawnArtifactWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(artifactWorkerInputSchema))
  .handler(({ data }): Promise<{ sessionId: string }> => executeArtifactWorker(data));

/** Cancel a queued or running worker owned by this artifact. */
export const cancelArtifactWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(cancelArtifactWorkerInputSchema))
  .handler(({ data }): Promise<boolean> => cancelArtifactWorkerExecution(data));

async function requireArtifactPath(sessionId: string, path: string): Promise<string> {
  const target = await resolveArtifactPath(sessionId, path);
  if (!target) throw new Error("Invalid artifact path.");
  return target;
}
