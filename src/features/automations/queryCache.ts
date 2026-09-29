import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { Automation } from "./model";
import { automationQueries } from "./queries";

export function applyAutomationListEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
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
  // Replace an overlapping snapshot with a read started after the committed change.
  if (queryClient.getQueryState(automationQueries.listKey())?.fetchStatus === "fetching") {
    void queryClient.refetchQueries({ queryKey: automationQueries.listKey(), exact: true });
  }
}

export function invalidateAutomationListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: automationQueries.listKey(), exact: true });
}
