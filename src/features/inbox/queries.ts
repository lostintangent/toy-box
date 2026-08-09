import { queryOptions } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { isWorkspaceSessionRunning } from "@workspace/model/state/reducer";

export const inboxQueries = {
  list: () =>
    queryOptions({
      ...workspaceQueries.state(),
      select: (workspace) =>
        [...workspace.inboxEntries].sort((left, right) => {
          const leftRunning = isWorkspaceSessionRunning(workspace.sessionStates[left.id]);
          const rightRunning = isWorkspaceSessionRunning(workspace.sessionStates[right.id]);
          return (
            Number(rightRunning) - Number(leftRunning) ||
            right.createdAt.localeCompare(left.createdAt)
          );
        }),
    }),
};
