import { mutationOptions } from "@tanstack/react-query";
import type { CancelWorkerInput, SpawnWorkerInput } from "./model";
import { workerQueries } from "./queries";
import { cancelWorker, spawnWorker } from "./server/functions";

export const workerMutations = {
  /** Resolves after refreshing active Workers, so callers hand off to the authoritative list. */
  spawn: mutationOptions({
    mutationFn: (input: SpawnWorkerInput) => spawnWorker({ data: input }),
    onSuccess: (_worker, _input, _result, { client }) => workerQueries.active.refresh(client),
  }),
  cancel: mutationOptions({
    mutationFn: (input: CancelWorkerInput) => cancelWorker({ data: input }),
  }),
};
