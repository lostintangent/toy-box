import { queryOptions } from "@tanstack/react-query";
import { getProviderCatalog } from "./server/functions";

export const providerQueries = {
  all: () => ["providers"] as const,

  catalog: () =>
    queryOptions({
      queryKey: providerQueries.all(),
      queryFn: getProviderCatalog,
      staleTime: Infinity,
    }),
};
