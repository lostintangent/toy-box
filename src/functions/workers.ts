// RPC boundary for file- and app-owned workers. TanStack keeps handler-only dependencies in
// the server graph, so admission remains a plain static import.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { cancelWorkerOnServer, spawnWorkerOnServer } from "./workers/admission";
import { sessionLaunchSchema } from "@/lib/session/protocol";
import { sessionFileSchema } from "@/lib/files/workspaceFile";
import { smallJsonSchema } from "@/lib/smallJson";

const workerResourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), file: sessionFileSchema }),
  z.object({
    type: z.literal("app"),
    appId: z.string().min(1),
    ephemeral: z.boolean().optional(),
  }),
]);

const spawnWorkerInputSchema = z.intersection(
  sessionLaunchSchema.extend({
    name: z.string().trim().min(1).max(100).optional(),
    metadata: smallJsonSchema.optional(),
  }),
  workerResourceSchema,
);

const workerInputSchema = z.intersection(
  z.object({ workerSessionId: z.string().min(1) }),
  workerResourceSchema,
);

/** Spawn a background worker owned by a file or app. */
export const spawnWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(spawnWorkerInputSchema))
  .handler(({ data }): Promise<{ sessionId: string }> => spawnWorkerOnServer(data));

/** Cancel a queued or running worker through its exact owner. */
export const cancelWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(workerInputSchema))
  .handler(({ data }): Promise<boolean> => cancelWorkerOnServer(data));
