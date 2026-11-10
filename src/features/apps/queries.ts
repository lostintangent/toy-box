import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { workspaceFileId, type SessionFile } from "@files/model";
import { reducedQuery } from "@/shared/query";
import { reduceAppList } from "./model/catalog";
import { getAppDefinitionBundle, getArtifactAppBundle, listApps } from "./server/functions";

export const appQueries = {
  list: reducedQuery({
    queryKey: ["apps", "list"],
    fetch: ({ signal }) => listApps({ signal }),
    reduce: reduceAppList,
  }),

  bundle: (definitionId: string, revision: string) =>
    queryOptions({
      queryKey: ["apps", "definitions", definitionId, "bundle", revision] as const,
      queryFn: async () => {
        const [{ evaluateAppBundle }, bundle] = await Promise.all([
          import("./components/host/bundle"),
          getAppDefinitionBundle({ data: { definitionId, revision } }),
        ]);
        return { ...evaluateAppBundle(definitionId, bundle), scopeId: definitionId };
      },
      staleTime: Infinity,
      retry: false,
    }),

  artifactBundle: (file: SessionFile, revision: number) =>
    queryOptions({
      queryKey: ["apps", "artifacts", workspaceFileId(file), "bundle", revision] as const,
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
