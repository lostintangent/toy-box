import { queryOptions } from "@tanstack/react-query";
import { listAutomations } from "./server/functions";

export const automationQueries = {
  listKey: () => ["automations", "list"] as const,

  list: () =>
    queryOptions({
      queryKey: automationQueries.listKey(),
      queryFn: listAutomations,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
