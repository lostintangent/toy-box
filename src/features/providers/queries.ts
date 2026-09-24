import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { getProviderCatalog, getProviderVersions, updateProvider } from "./server/functions";

export type ProviderUpdateResult = Awaited<ReturnType<typeof updateProvider>>;

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

export const providerMutations = {
  updateKey: () => [...providerQueries.all(), "update"] as const,

  update: () =>
    mutationOptions({
      mutationKey: providerMutations.updateKey(),
      mutationFn: (providerId: string) => updateProvider({ data: providerId }),
      gcTime: 3000,
    }),
};
