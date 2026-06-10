import type { CopilotSession, SessionConfig as SdkSessionConfig } from "@github/copilot-sdk";
import { z } from "zod";
import type { ModelConfiguration, ReasoningEffort } from "@/types";

export const modelConfigurationSchema = z
  .object({
    model: z.string().trim().min(1).describe("Model ID"),
    reasoningEffort: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Reasoning effort for models that support it"),
  })
  // Preserve future SDK/catalog knobs so adding the next model config field
  // only needs type, SDK-boundary, and picker updates.
  .passthrough();

type ReasoningModelInfo = {
  supportedReasoningEfforts?: readonly ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
};
type ModelCatalogInfo = ReasoningModelInfo & { id: string };
type SdkSetModelOptions = NonNullable<Parameters<CopilotSession["setModel"]>[1]>;
type SdkReasoningEffort = NonNullable<SdkSessionConfig["reasoningEffort"]>;
type SdkSessionModelOptions = Pick<SdkSessionConfig, "model" | "reasoningEffort">;

/** The SDK's public type is narrower than the generated protocol and live
 *  model metadata, so keep the cast in one boundary helper. */
export function toSdkReasoningEffort(
  reasoningEffort?: ReasoningEffort,
): SdkReasoningEffort | undefined {
  return reasoningEffort as SdkReasoningEffort | undefined;
}

export function toSdkSetModelOptions(configuration?: ModelConfiguration): SdkSetModelOptions {
  return {
    ...(configuration?.reasoningEffort
      ? { reasoningEffort: toSdkReasoningEffort(configuration.reasoningEffort) }
      : {}),
  };
}

export function toSdkSessionModelOptions(
  configuration?: ModelConfiguration,
): SdkSessionModelOptions {
  return {
    model: configuration?.model,
    ...toSdkSetModelOptions(configuration),
  };
}

export function parseModelConfiguration(value: unknown): ModelConfiguration | null {
  const result = modelConfigurationSchema.safeParse(value);
  return result.success ? (result.data as ModelConfiguration) : null;
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
  model: ReasoningModelInfo | undefined,
  configuration: ModelConfiguration,
): ModelConfiguration {
  return {
    ...configuration,
    reasoningEffort: resolveModelReasoningEffort(model, configuration.reasoningEffort),
  };
}

export function normalizeModelConfiguration(
  models: readonly ModelCatalogInfo[],
  configuration?: ModelConfiguration | null,
): ModelConfiguration | null {
  if (models.length === 0) return configuration ?? null;

  const model = models.find((candidate) => candidate.id === configuration?.model) ?? models[0];
  return resolveModelConfigurationForModel(model, {
    ...configuration,
    model: model.id,
  });
}

function resolveModelReasoningEffort(
  model: ReasoningModelInfo | undefined,
  requestedReasoningEffort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  return getModelReasoningConfig(model, requestedReasoningEffort).reasoningEffort;
}

export function getModelReasoningConfig(
  model: ReasoningModelInfo | undefined,
  requestedReasoningEffort: ReasoningEffort | undefined,
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

export function formatReasoningEffort(reasoningEffort: ReasoningEffort) {
  return reasoningEffort
    .replace(/^xhigh$/i, "Extra High")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
