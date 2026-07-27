// RPC boundary for spawning and cancelling background workers, optionally scoped to
// a workspace file. The server-only admission (and its Node/SDK imports) lives in
// ./workers/admission, imported only inside handlers so it stays out of the client bundle.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { workspaceFileSchema } from "@/lib/files/workspaceFile";
import { cancelWorkerOnServer, spawnWorkerOnServer } from "@/functions/workers/admission";
import type { JsonValue } from "@/types";

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

const spawnWorkerInputSchema = z.object({
  file: workspaceFileSchema,
  name: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(100_000),
  metadata: jsonValueSchema.optional(),
});

const cancelWorkerInputSchema = z.object({
  file: workspaceFileSchema,
  workerSessionId: z.string().min(1),
});

/** Spawn a renderer-authored background worker for a file, serialized per file. */
export const spawnWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(spawnWorkerInputSchema))
  .handler(({ data }): Promise<{ sessionId: string }> => spawnWorkerOnServer(data));

/** Cancel a queued or running worker owned by this file. */
export const cancelWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(cancelWorkerInputSchema))
  .handler(({ data }): Promise<boolean> => cancelWorkerOnServer(data));
