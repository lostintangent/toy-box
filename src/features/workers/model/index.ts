import { z } from "zod";
import { sessionFileSchema, type SessionFile } from "@files/model";
import { sessionLaunchSchema } from "@sessions/model/protocol";
import { smallJsonSchema } from "@/shared/smallJson";

const fileOwnerSchema = z.object({
  type: z.literal("file"),
  file: sessionFileSchema,
});

const appOwnerSchema = z.object({
  type: z.literal("app"),
  appId: z.string().min(1),
});

export const workerNameSchema = z.string().trim().min(1).max(100);

const workerDetailsSchema = z.object({
  name: workerNameSchema.optional(),
  metadata: smallJsonSchema.optional(),
});

const spawnWorkerOwnerSchema = z.discriminatedUnion("type", [
  fileOwnerSchema,
  appOwnerSchema.extend({ ephemeral: z.boolean().optional() }),
]);

export const spawnWorkerInputSchema = sessionLaunchSchema
  .and(workerDetailsSchema)
  .and(spawnWorkerOwnerSchema);

export const cancelWorkerInputSchema = z
  .discriminatedUnion("type", [fileOwnerSchema, appOwnerSchema])
  .and(z.object({ workerSessionId: z.string().min(1) }));

export type SpawnWorkerInput = z.infer<typeof spawnWorkerInputSchema>;
export type CancelWorkerInput = z.infer<typeof cancelWorkerInputSchema>;

export type WorkerOwner =
  | { type: "session"; parentSessionId: string }
  | { type: "file"; file: SessionFile }
  | { type: "app"; appId: string }
  | { type: "channel"; channelId: string }
  | { type: "inbox" };

/** A Session identity whose lifecycle belongs to another resource. */
export type Worker = WorkerOwner & {
  sessionId: string;
  createdAt: string;
  ephemeral: boolean;
  name?: z.infer<typeof workerNameSchema>;
  metadata?: z.infer<typeof smallJsonSchema>;
};

export type WorkerEvent =
  | { type: "worker.started"; worker: Worker }
  | { type: "worker.finished"; sessionId: string };

export function workerParentSessionId(worker: Worker): string | undefined {
  switch (worker.type) {
    case "session":
      return worker.parentSessionId;
    case "file":
      return worker.file.sessionId;
    case "app":
    case "channel":
    case "inbox":
      return;
  }
}

/** Whether this is the worker's session or the session that directly parents it. */
export function workerReferencesSession(worker: Worker, sessionId: string): boolean {
  return worker.sessionId === sessionId || workerParentSessionId(worker) === sessionId;
}
