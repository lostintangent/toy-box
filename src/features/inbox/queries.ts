import { queryOptions } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";

export const inboxQueries = {
  list: () =>
    queryOptions({
      ...workspaceQueries.state(),
      select: (workspace) =>
        [...workspace.inboxEntries].sort((left, right) => {
          const leftRunning = workspace.sessionStates[left.id]?.status === "running";
          const rightRunning = workspace.sessionStates[right.id]?.status === "running";
          return (
            Number(rightRunning) - Number(leftRunning) ||
            right.createdAt.localeCompare(left.createdAt)
          );
        }),
    }),
};
