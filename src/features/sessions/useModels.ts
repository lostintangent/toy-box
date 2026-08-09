import { useQuery } from "@tanstack/react-query";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import type { ModelInfo } from "./model";
import { normalizeModelConfiguration, type ModelConfiguration } from "./model/modelConfiguration";
import { modelQueries } from "./queries";

const NO_MODELS: ModelInfo[] = [];

/** The available models and workspace-wide default used to seed new work. */
export function useModels() {
  const { data: models = NO_MODELS } = useQuery(modelQueries.list());
  const storedDefaultModel = useWorkspaceSelector((workspace) => workspace.settings.defaultModel);
  const updateSetting = useUpdateWorkspaceSetting();
  const defaultModel =
    models.length > 0 ? normalizeModelConfiguration(models, storedDefaultModel) : null;

  function setDefaultModel(model: ModelConfiguration): void {
    updateSetting("defaultModel", model);
  }

  return { models, defaultModel, setDefaultModel };
}
