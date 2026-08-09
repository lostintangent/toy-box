import { mutationOptions } from "@tanstack/react-query";
import type { CancelWorkerInput, SpawnWorkerInput } from "./model";
import { cancelWorker, spawnWorker } from "./server/functions";

export const workerMutations = {
  spawn: mutationOptions({
    mutationFn: (input: SpawnWorkerInput) => spawnWorker({ data: input }),
  }),
  cancel: mutationOptions({
    mutationFn: (input: CancelWorkerInput) => cancelWorker({ data: input }),
  }),
};
