import { queryOptions } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { getAppDefinitionBundle } from "./server/functions";

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
};
