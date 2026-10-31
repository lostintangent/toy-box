import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCache } from "@workspace/sync";
import { replaceOverlappingRead } from "@/shared/query";
import type { Automation } from "./model";
import { automationQueries } from "./queries";

export default {
  applyEvent(queryClient, event) {
    switch (event.type) {
      case "automation.upserted":
        queryClient.setQueryData<Automation[]>(automationQueries.listKey(), (list) =>
          list
            ? [...list.filter(({ id }) => id !== event.automation.id), event.automation].sort(
                (left, right) =>
                  right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
              )
            : list,
        );
        break;
      case "automation.deleted":
        queryClient.setQueryData<Automation[]>(automationQueries.listKey(), (list) =>
          list?.filter(({ id }) => id !== event.automationId),
        );
        break;
      default:
        return;
    }
    replaceOverlappingRead(queryClient, automationQueries.listKey());
  },
  refresh: invalidateAutomationListQuery,
} satisfies WorkspaceCache;

export function invalidateAutomationListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: automationQueries.listKey(), exact: true });
}
