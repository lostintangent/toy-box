import { z } from "zod";

export const modelConfigurationSchema = z.object({
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
});

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

/**
 * Only a ready provider contributes models; a signed-out one still lists its history, and only a
 * failed one carries its native discovery `error`.
 */
export type SessionProviderStatus = "unavailable" | "signedOut" | "ready" | "failed";

export type ProviderCatalog = {
  providers: { id: string; name: string; status: SessionProviderStatus; error?: string }[];
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

/** `model`'s configuration, keeping the seed's options it supports and defaulting the rest. */
export function modelConfiguration(
  model: ModelCatalogInfo,
  seed?: Pick<ModelConfiguration, "reasoningEffort" | "contextTier"> | null,
): ModelConfiguration {
  const efforts = model.supportedReasoningEfforts ?? [];
  const reasoningEffort =
    seed?.reasoningEffort && efforts.includes(seed.reasoningEffort)
      ? seed.reasoningEffort
      : (model.defaultReasoningEffort ?? efforts[0]);
  const tiers = model.supportedContextTiers ?? [];
  const contextTier = tiers.find(({ name }) => name === seed?.contextTier)?.name ?? tiers[0]?.name;
  return {
    provider: model.provider,
    name: model.id,
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
  return modelConfiguration(model, configuration);
}

export function formatReasoningEffort(reasoningEffort: string) {
  return reasoningEffort
    .replace(/^xhigh$/i, "Extra High")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
