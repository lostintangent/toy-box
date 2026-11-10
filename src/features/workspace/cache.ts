import { providerQueries } from "@providers/queries";
import { sessionQueries } from "@sessions/queries";
import { CATALOG_SETTINGS, isSettingEqual, type Settings } from "./model/config/settings";
import { workspaceQueries } from "./queries";
import type { WorkspaceCache } from "./sync";

export default {
  preload: (queryClient) => queryClient.ensureQueryData(workspaceQueries.state),
  applyEvent(queryClient, event) {
    const previousSettings = queryClient.getQueryData(workspaceQueries.state.queryKey)?.settings;
    workspaceQueries.state.apply(queryClient, event);
    if (event.type === "settings.changed") {
      const changed = (key: keyof Settings) =>
        !previousSettings || !isSettingEqual(key, previousSettings, event.settings);
      if (changed("disabledProviders")) {
        void queryClient.invalidateQueries({ queryKey: providerQueries.all() });
      }
      if (CATALOG_SETTINGS.some(changed)) void sessionQueries.state.refresh(queryClient);
    }
  },
  refresh: workspaceQueries.state.refresh,
} satisfies WorkspaceCache;
