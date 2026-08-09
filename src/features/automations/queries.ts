import { queryOptions } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";

export const automationQueries = {
  list: () =>
    queryOptions({
      ...workspaceQueries.state(),
      select: (workspace) => workspace.automations,
    }),
};
