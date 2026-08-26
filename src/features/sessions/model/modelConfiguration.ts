import type { CopilotSession, SessionConfig as SdkSessionConfig } from "@github/copilot-sdk";
import { z } from "zod";

export const modelConfigurationSchema = z
  .object({
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
  .catchall(z.json());

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
type ModelCatalogInfo = ModelOptionInfo & { id: string };
type SdkSetModelOptions = NonNullable<Parameters<CopilotSession["setModel"]>[1]>;
type SdkSessionModelOptions = Pick<SdkSessionConfig, "model" | "reasoningEffort" | "contextTier">;

/** The SDK's public option unions are narrower than live metadata, so keep
 *  open-string casts in these boundary helpers. */
function toSdkReasoningEffort(reasoningEffort?: string): SdkSessionConfig["reasoningEffort"] {
  return reasoningEffort as SdkSessionConfig["reasoningEffort"];
}

function toSdkContextTier(contextTier?: string): SdkSessionConfig["contextTier"] {
  return contextTier as SdkSessionConfig["contextTier"];
}

export function toSdkSetModelOptions(configuration?: ModelConfiguration): SdkSetModelOptions {
  return {
    ...(configuration?.reasoningEffort
      ? { reasoningEffort: toSdkReasoningEffort(configuration.reasoningEffort) }
      : {}),
    ...(configuration?.contextTier
      ? { contextTier: toSdkContextTier(configuration.contextTier) }
      : {}),
  };
}

export function toSdkSessionModelOptions(
  configuration?: ModelConfiguration,
): SdkSessionModelOptions {
  return {
    model: configuration?.name,
    ...toSdkSetModelOptions(configuration),
  };
}

function parseModelConfiguration(value: unknown): ModelConfiguration | null {
  const result = modelConfigurationSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSerializedModelConfiguration(value: string | null): ModelConfiguration | null {
  if (!value) return null;

  try {
    return parseModelConfiguration(JSON.parse(value));
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

  const model = models.find((candidate) => candidate.id === configuration?.name) ?? models[0];
  return resolveModelConfigurationForModel(model, {
    ...configuration,
    name: model.id,
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
