import { useQuery } from "@tanstack/react-query";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import type { ModelInfo } from "./model";
import {
  normalizeModelConfiguration,
  type ContextTier,
  type ModelConfiguration,
  type ModelOptionInfo,
} from "./model/modelConfiguration";
import { modelQueries } from "./queries";

export type ModelCatalogInfo = ModelInfo & ModelOptionInfo;

/** The available models and workspace-wide default used to seed new work. */
export function useModels() {
  const { data: models = [] } = useQuery({
    ...modelQueries.list(),
    select: adaptModelCatalog,
  });
  const storedDefaultModel = useWorkspaceSelector((workspace) => workspace.settings.defaultModel);
  const updateSetting = useUpdateWorkspaceSetting();
  const defaultModel =
    models.length > 0 ? normalizeModelConfiguration(models, storedDefaultModel) : null;

  function setDefaultModel(model: ModelConfiguration): void {
    updateSetting("defaultModel", model);
  }

  return { models, defaultModel, setDefaultModel };
}

/** Decorate SDK models with context-window metadata derived from current catalog limits. */
export function adaptModelCatalog(models: readonly ModelCatalogInfo[]): ModelCatalogInfo[] {
  return models.map((model) => {
    if (model.supportedContextTiers !== undefined) return model;

    const supportedContextTiers = deriveContextTiers(model);
    if (!supportedContextTiers) return model;

    return {
      ...model,
      supportedContextTiers,
    };
  });
}

function deriveContextTiers(model: ModelCatalogInfo): ContextTier[] | undefined {
  const tokenPrices = model.billing?.tokenPrices;
  const defaultPromptTokens = tokenPrices?.maxPromptTokens ?? tokenPrices?.contextMax;
  const { max_context_window_tokens: longTokenWindow, max_prompt_tokens: longPromptTokens } =
    model.capabilities.limits;

  if (
    !tokenPrices?.longContext ||
    defaultPromptTokens === undefined ||
    longPromptTokens === undefined
  ) {
    return undefined;
  }

  // Billing supplies the default prompt budget; capabilities supply the reserved output window.
  const outputTokens = longTokenWindow - longPromptTokens;
  return [
    {
      name: "default",
      tokenWindow: defaultPromptTokens + outputTokens,
    },
    { name: "long_context", tokenWindow: longTokenWindow },
  ];
}
