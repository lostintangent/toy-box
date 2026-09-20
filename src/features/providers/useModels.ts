import { useQuery } from "@tanstack/react-query";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import { normalizeModelConfiguration, type ModelConfiguration } from "./model";
import { providerQueries } from "./queries";

export function useHasModels(): boolean {
  const { data = false } = useQuery({
    ...providerQueries.catalog(),
    select: ({ models }) => models.length > 0,
  });
  return data;
}

/** Available models, optionally scoped to one provider, and the workspace-wide default. */
export function useModels(provider?: ModelConfiguration["provider"]) {
  const { data: catalog = [] } = useQuery({
    ...providerQueries.catalog(),
    select: ({ models }) => models,
  });
  const storedDefaultModel = useWorkspaceSelector((workspace) => workspace.settings.defaultModel);
  const updateSetting = useUpdateWorkspaceSetting();
  const models = provider ? catalog.filter((model) => model.provider === provider) : catalog;
  const defaultModel =
    catalog.length > 0 ? normalizeModelConfiguration(catalog, storedDefaultModel) : null;

  function setDefaultModel(model: ModelConfiguration): void {
    updateSetting("defaultModel", model);
  }

  return { models, hasModels: models.length > 0, defaultModel, setDefaultModel };
}
