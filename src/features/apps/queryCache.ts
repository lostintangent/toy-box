import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { AppList } from "./model";
import { appQueries } from "./queries";

export function applyAppListEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  switch (event.type) {
    case "app.registered":
      queryClient.setQueryData<AppList>(appQueries.listKey(), (list) => {
        if (!list) return list;
        const current = list.definitions.find(({ id }) => id === event.definition.id);
        if (current?.revision === event.definition.revision) return list;
        return {
          ...list,
          definitions: [
            ...list.definitions.filter(({ id }) => id !== event.definition.id),
            event.definition,
          ].sort((left, right) => left.title.localeCompare(right.title)),
        };
      });
      break;
    case "app.unregistered":
      queryClient.setQueryData<AppList>(appQueries.listKey(), (list) =>
        list
          ? { ...list, definitions: list.definitions.filter(({ id }) => id !== event.definitionId) }
          : list,
      );
      break;
    case "app.upserted":
      queryClient.setQueryData<AppList>(appQueries.listKey(), (list) => {
        if (!list) return list;
        const current = list.apps.find(({ id }) => id === event.app.id);
        if (current && current.revision >= event.app.revision) return list;
        return {
          ...list,
          apps: [...list.apps.filter(({ id }) => id !== event.app.id), event.app].sort(
            (left, right) =>
              left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
          ),
        };
      });
      break;
    case "app.deleted":
      queryClient.setQueryData<AppList>(appQueries.listKey(), (list) =>
        list
          ? {
              ...list,
              apps: list.apps.filter(({ id }) => id !== event.appId),
              shares: list.shares
                .filter((share) => share.targetAppId !== event.appId)
                .map((share) =>
                  share.sourceAppId === event.appId ? { ...share, sourceAppId: null } : share,
                ),
            }
          : list,
      );
      break;
    case "app.share.created":
      queryClient.setQueryData<AppList>(appQueries.listKey(), (list) =>
        list
          ? {
              ...list,
              shares: [...list.shares.filter(({ id }) => id !== event.share.id), event.share].sort(
                (left, right) => left.createdAt.localeCompare(right.createdAt),
              ),
            }
          : list,
      );
      break;
    case "app.share.deleted":
      queryClient.setQueryData<AppList>(appQueries.listKey(), (list) =>
        list ? { ...list, shares: list.shares.filter(({ id }) => id !== event.shareId) } : list,
      );
      break;
    default:
      return;
  }
  // Replace an overlapping snapshot with a read started after the committed change.
  if (queryClient.getQueryState(appQueries.listKey())?.fetchStatus === "fetching") {
    void queryClient.refetchQueries({ queryKey: appQueries.listKey(), exact: true });
  }
}

export function invalidateAppListQuery(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: appQueries.listKey(), exact: true });
}
