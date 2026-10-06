import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { workspaceFileId, type SessionFile } from "@files/model";
import { getAppDefinitionBundle, getArtifactAppBundle, listApps } from "./server/functions";

export const appQueries = {
  all: () => ["apps"] as const,

  listKey: () => [...appQueries.all(), "list"] as const,

  list: () =>
    queryOptions({
      queryKey: appQueries.listKey(),
      queryFn: listApps,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),

  bundle: (definitionId: string, revision: string) =>
    queryOptions({
      queryKey: [...appQueries.all(), "definitions", definitionId, "bundle", revision] as const,
      queryFn: async () => {
        const [{ evaluateAppBundle }, bundle] = await Promise.all([
          import("./components/host/bundle"),
          getAppDefinitionBundle({ data: { definitionId, revision } }),
        ]);
        return evaluateAppBundle(definitionId, bundle);
      },
      staleTime: Infinity,
      retry: false,
    }),

  artifactBundle: (file: SessionFile, revision: number) =>
    queryOptions({
      queryKey: [
        ...appQueries.all(),
        "artifacts",
        workspaceFileId(file),
        "bundle",
        revision,
      ] as const,
      queryFn: async () => {
        const [{ evaluateAppBundle }, compiled] = await Promise.all([
          import("./components/host/bundle"),
          getArtifactAppBundle({ data: { file } }),
        ]);
        return {
          ...evaluateAppBundle(file.path, compiled.bundle),
          scopeId: compiled.scopeId,
        };
      },
      placeholderData: keepPreviousData,
      staleTime: Infinity,
      retry: false,
    }),
};
