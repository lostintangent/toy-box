import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { atomWithStorage, createJSONStorage, unstable_withStorageValidator } from "jotai/utils";
import {
  areModelConfigurationsEqual,
  modelConfigurationSchema,
  normalizeModelConfiguration,
} from "@/lib/modelConfiguration";
import { modelQueries } from "@/lib/queries";
import type { ModelConfiguration, ModelInfo } from "@/types";

const DEFAULT_MODEL_KEY = "selected-model-configuration";
const NO_MODELS: ModelInfo[] = [];

const defaultModelStorage = unstable_withStorageValidator(
  (value): value is ModelConfiguration | null =>
    value === null || modelConfigurationSchema.safeParse(value).success,
)(createJSONStorage<unknown>());

// Keep raw storage private so every consumer gets a catalog-normalized model.
// Read eagerly; `useHydrated` keeps the client value out of the server render.
const defaultModelAtom = atomWithStorage<ModelConfiguration | null>(
  DEFAULT_MODEL_KEY,
  null,
  defaultModelStorage,
  { getOnInit: true },
);

/** The available models and browser-wide default used to seed new work. */
export function useModels() {
  const hydrated = useHydrated();
  const { data: models = NO_MODELS } = useQuery(modelQueries.list());
  const [storedDefaultModel, setDefaultModel] = useAtom(defaultModelAtom);

  const defaultModel =
    hydrated && models.length > 0 ? normalizeModelConfiguration(models, storedDefaultModel) : null;

  useEffect(() => {
    if (!defaultModel || areModelConfigurationsEqual(storedDefaultModel, defaultModel)) return;
    setDefaultModel(defaultModel);
  }, [defaultModel, setDefaultModel, storedDefaultModel]);

  return {
    models,
    defaultModel,
    setDefaultModel,
    isLoading: defaultModel === null,
  };
}
