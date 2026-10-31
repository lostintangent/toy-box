// RPC boundary for file- and app-owned workers. TanStack keeps handler-only dependencies in
// the server graph, so admission remains a plain static import.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { cancelWorkerInputSchema, spawnWorkerInputSchema } from "../model";
import * as workers from "./admission";
import { getWorkers } from "./registry";

/** The pending workers every client shows on their owners. */
export const listActiveWorkers = createServerFn({ method: "GET" }).handler(() => getWorkers());

/** Spawn a background worker owned by a file or app. */
export const spawnWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(spawnWorkerInputSchema))
  .handler(({ data }): Promise<{ sessionId: string }> => workers.spawnWorkerFromRequest(data));

/** Cancel a queued or running worker through its exact owner. */
export const cancelWorker = createServerFn({ method: "POST" })
  .validator(zodValidator(cancelWorkerInputSchema))
  .handler(({ data }): Promise<boolean> => workers.cancelWorker(data));
