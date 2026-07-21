import { useQuery } from "@tanstack/react-query";
import { normalizeModelConfiguration } from "@/lib/modelConfiguration";
import { modelQueries } from "@/lib/queries";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "./state";
import type { ModelConfiguration, ModelInfo } from "@/types";

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
