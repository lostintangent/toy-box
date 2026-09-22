import { queryOptions } from "@tanstack/react-query";
import { getProviderCatalog, getProviderVersions } from "./server/functions";

export const providerQueries = {
  all: () => ["providers"] as const,

  catalog: () =>
    queryOptions({
      queryKey: providerQueries.all(),
      queryFn: getProviderCatalog,
      staleTime: Infinity,
    }),

  versions: () =>
    queryOptions({
      queryKey: [...providerQueries.all(), "versions"],
      queryFn: getProviderVersions,
    }),
};
