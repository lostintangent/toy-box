import type { WorkspaceEvents } from "@workspace/model/events";
import type { AppList } from ".";

/** The catalog's transition function for every client. Definitions and saved apps stay
 *  title-sorted, saved apps advance only to newer revisions, and shares follow their target. */
export function reduceAppList(list: AppList, event: WorkspaceEvents["apps"]): AppList {
  switch (event.type) {
    case "app.registered": {
      const current = list.definitions.find(({ id }) => id === event.definition.id);
      if (current?.revision === event.definition.revision) return list;
      return {
        ...list,
        definitions: [
          ...list.definitions.filter(({ id }) => id !== event.definition.id),
          event.definition,
        ].sort((left, right) => left.title.localeCompare(right.title)),
      };
    }
    case "app.unregistered":
      return {
        ...list,
        definitions: list.definitions.filter(({ id }) => id !== event.definitionId),
      };
    case "app.upserted": {
      const current = list.apps.find(({ id }) => id === event.app.id);
      if (current && current.revision >= event.app.revision) return list;
      return {
        ...list,
        apps: [...list.apps.filter(({ id }) => id !== event.app.id), event.app].sort(
          (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
        ),
      };
    }
    case "app.deleted":
      return {
        ...list,
        apps: list.apps.filter(({ id }) => id !== event.appId),
        shares: list.shares
          .filter((share) => share.targetAppId !== event.appId)
          .map((share) =>
            share.sourceAppId === event.appId ? { ...share, sourceAppId: null } : share,
          ),
      };
    case "app.share.created":
      return {
        ...list,
        shares: [...list.shares.filter(({ id }) => id !== event.share.id), event.share].sort(
          (left, right) => left.createdAt.localeCompare(right.createdAt),
        ),
      };
    case "app.share.deleted":
      return { ...list, shares: list.shares.filter(({ id }) => id !== event.shareId) };
  }
}
