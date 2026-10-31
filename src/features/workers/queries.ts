import { queryOptions } from "@tanstack/react-query";
import { listActiveWorkers } from "./server/functions";

export const workerQueries = {
  activeKey: () => ["workers", "active"] as const,

  active: () =>
    queryOptions({
      queryKey: workerQueries.activeKey(),
      queryFn: listActiveWorkers,
      staleTime: Infinity,
      // Resident like the workspace snapshot it came from, so a later pane never suspends on it.
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
