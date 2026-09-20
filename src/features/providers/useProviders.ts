import { useQuery } from "@tanstack/react-query";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import { providerQueries } from "./queries";

/** Installation is discovered; enablement is the owner's workspace preference. */
export function useProviders() {
  const { data } = useQuery(providerQueries.catalog());
  const disabledProviders = useWorkspaceSelector(
    (workspace) => workspace.settings.disabledProviders,
  );
  const updateSetting = useUpdateWorkspaceSetting();

  function setEnabled(id: string, enabled: boolean): void {
    updateSetting(
      "disabledProviders",
      enabled
        ? disabledProviders.filter((provider) => provider !== id)
        : [...disabledProviders, id],
    );
  }

  return {
    providers: (data?.providers ?? []).map((provider) => ({
      ...provider,
      enabled: !disabledProviders.includes(provider.id),
    })),
    hasModels: (data?.models.length ?? 0) > 0,
    setEnabled,
  };
}
