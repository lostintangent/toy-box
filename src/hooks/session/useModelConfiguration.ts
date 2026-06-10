import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelConfiguration, ModelInfo } from "@/types";
import {
  areModelConfigurationsEqual,
  normalizeModelConfiguration,
  parseSerializedModelConfiguration,
} from "@/lib/modelConfiguration";

const SELECTED_MODEL_CONFIGURATION_KEY = "selected-model-configuration";

export function useModelConfiguration(
  models: readonly ModelInfo[],
): [ModelConfiguration | null, (configuration: ModelConfiguration) => void] {
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    setConfiguration(
      parseSerializedModelConfiguration(localStorage.getItem(SELECTED_MODEL_CONFIGURATION_KEY)),
    );
    hasHydratedRef.current = true;
    setHasHydrated(true);
  }, []);

  const setStoredConfiguration = useCallback((nextConfiguration: ModelConfiguration) => {
    setConfiguration(nextConfiguration);
    if (!hasHydratedRef.current) return;
    localStorage.setItem(SELECTED_MODEL_CONFIGURATION_KEY, JSON.stringify(nextConfiguration));
  }, []);

  useEffect(() => {
    if (!hasHydrated || models.length === 0) return;

    const normalized = normalizeModelConfiguration(models, configuration ?? undefined);
    if (!normalized) return;
    if (areModelConfigurationsEqual(configuration, normalized)) return;
    setStoredConfiguration(normalized);
  }, [configuration, hasHydrated, models, setStoredConfiguration]);

  return [configuration, setStoredConfiguration];
}
