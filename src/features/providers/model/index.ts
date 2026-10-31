import { z } from "zod";

export const modelConfigurationSchema = z
  .object({
    provider: z.string().trim().min(1).describe("Session provider"),
    name: z.string().trim().min(1).describe("Model name"),
    reasoningEffort: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Reasoning effort for models that support it"),
    contextTier: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Context tier for models that support it"),
  })
  // Preserve future JSON-valued SDK/catalog knobs so adding one only needs
  // its boundary behavior and picker updated.
  .catchall(z.json().optional());

export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>;

export type ContextTier = {
  name: string;
  tokenWindow: number;
};

export type ModelOptionInfo = {
  supportedReasoningEfforts?: readonly string[];
  defaultReasoningEffort?: string;
  /** Ordered with the model's default tier first. */
  supportedContextTiers?: readonly ContextTier[];
};

export type ModelInfo = ModelOptionInfo & {
  id: string;
  name: string;
  provider: string;
  providerName?: string;
};

/** Only a ready provider contributes models; a signed-out one still lists its history. */
export type SessionProviderStatus = "unavailable" | "signedOut" | "ready";

export type ProviderCatalog = {
  providers: { id: string; name: string; status: SessionProviderStatus }[];
  models: ModelInfo[];
};

declare module "@workspace/model/events" {
  interface WorkspaceEvents {
    providers: { type: "providers.changed" };
  }
}

/** The signed-in account's subscription: its plan and how much of each of its limits is used. */
export type ProviderSubscription = {
  /** The plan's native name, such as `pro`, `max`, or `enterprise`. */
  plan: string;
  /** Each limit renews on its own schedule, at `resetsAt` epoch milliseconds. */
  limits: { name: string; usedPercent: number; resetsAt?: number }[];
};

type ModelCatalogInfo = ModelOptionInfo & { id: string; provider: string };
/** Native model names are unique only within their provider. */
export function modelCatalogKey(model: { id: string; provider: string }): string {
  return `${model.provider}:${model.id}`;
}
export function modelConfigurationKey(model: ModelConfiguration): string {
  return modelCatalogKey({ id: model.name, provider: model.provider });
}

export function parseSerializedModelConfiguration(value: string | null): ModelConfiguration | null {
  if (!value) return null;

  try {
    const result = modelConfigurationSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function areModelConfigurationsEqual(
  a: ModelConfiguration | null | undefined,
  b: ModelConfiguration | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as keyof ModelConfiguration] !== b[key as keyof ModelConfiguration]) return false;
  }
  return true;
}

export function resolveModelConfigurationForModel(
  model: ModelOptionInfo | undefined,
  configuration: ModelConfiguration,
): ModelConfiguration {
  const {
    reasoningEffort: _currentReasoningEffort,
    contextTier: _currentContextTier,
    ...rest
  } = configuration;
  const reasoningEffort = getModelReasoningConfig(
    model,
    configuration.reasoningEffort,
  ).reasoningEffort;
  const contextTier = getModelContextTierConfig(model, configuration.contextTier).contextTier;
  return {
    ...rest,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(contextTier ? { contextTier } : {}),
  };
}

export function normalizeModelConfiguration(
  models: readonly ModelCatalogInfo[],
  configuration?: ModelConfiguration | null,
): ModelConfiguration | null {
  if (models.length === 0) return configuration ?? null;

  const model =
    models.find(
      (candidate) =>
        candidate.id === configuration?.name && candidate.provider === configuration?.provider,
    ) ?? models[0];
  return resolveModelConfigurationForModel(model, {
    ...configuration,
    name: model.id,
    provider: model.provider,
  });
}

export function getModelReasoningConfig(
  model: ModelOptionInfo | undefined,
  requestedReasoningEffort: string | undefined,
) {
  const supportedReasoningEfforts = model?.supportedReasoningEfforts ?? [];
  const reasoningEffort =
    requestedReasoningEffort && supportedReasoningEfforts.includes(requestedReasoningEffort)
      ? requestedReasoningEffort
      : (model?.defaultReasoningEffort ?? supportedReasoningEfforts[0]);

  return {
    supportedReasoningEfforts,
    reasoningEffort,
  };
}

export function getModelContextTierConfig(
  model: ModelOptionInfo | undefined,
  requestedContextTier: string | undefined,
) {
  const supportedContextTiers = model?.supportedContextTiers ?? [];
  const contextTier =
    supportedContextTiers.find(({ name }) => name === requestedContextTier)?.name ??
    supportedContextTiers[0]?.name;

  return {
    supportedContextTiers,
    contextTier,
  };
}

export function formatReasoningEffort(reasoningEffort: string) {
  return reasoningEffort
    .replace(/^xhigh$/i, "Extra High")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
