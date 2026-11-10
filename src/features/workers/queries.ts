import { reducedQuery } from "@/shared/query";
import { reduceActiveWorkers } from "./model/active";
import { listActiveWorkers } from "./server/functions";

export const workerQueries = {
  active: reducedQuery({
    queryKey: ["workers", "active"],
    fetch: ({ signal }) => listActiveWorkers({ signal }),
    reduce: reduceActiveWorkers,
  }),
};
