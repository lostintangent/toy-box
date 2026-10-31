import { providerQueries } from "@providers/queries";
import { invalidateSessionsStateQuery } from "@sessions/cache";
import type { WorkspaceState } from "./model/state/reducer";
import { workspaceJournal, workspaceQueries } from "./queries";
import type { WorkspaceCache } from "./sync";

export default {
  applyEvent(queryClient, event) {
    const previousSettings = queryClient.getQueryData<WorkspaceState>(
      workspaceQueries.stateKey(),
    )?.settings;
    workspaceJournal.apply(queryClient, event);
    if (event.type === "settings.changed") {
      const providersChanged =
        previousSettings?.disabledProviders.length !== event.settings.disabledProviders.length ||
        previousSettings.disabledProviders.some(
          (id) => !event.settings.disabledProviders.includes(id),
        );
      const pinsChanged =
        previousSettings?.pinnedSessionIds.length !== event.settings.pinnedSessionIds.length ||
        previousSettings.pinnedSessionIds.some(
          (id) => !event.settings.pinnedSessionIds.includes(id),
        );
      if (providersChanged) void queryClient.invalidateQueries({ queryKey: providerQueries.all() });
      if (providersChanged || pinsChanged) void invalidateSessionsStateQuery(queryClient);
    }
  },
  refresh: workspaceJournal.refresh,
} satisfies WorkspaceCache;
