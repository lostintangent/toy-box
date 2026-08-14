import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { workspaceFileId, type SessionFile } from "@files/model";
import { getAppDefinitionBundle, getArtifactAppBundle } from "./server/functions";

export const appQueries = {
  all: () => ["apps"] as const,

  list: () =>
    queryOptions({
      ...workspaceQueries.state(),
      select: (workspace) => ({
        apps: workspace.apps,
        definitions: workspace.appDefinitions,
      }),
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
