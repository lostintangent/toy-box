import { describe, expect, test } from "bun:test";
import {
  areModelConfigurationsEqual,
  formatReasoningEffort,
  getModelReasoningConfig,
  normalizeModelConfiguration,
  parseSerializedModelConfiguration,
  resolveModelConfigurationForModel,
  toSdkSessionModelOptions,
  toSdkSetModelOptions,
  type ContextTier,
} from "./modelConfiguration";

type ModelOptions = Parameters<typeof getModelReasoningConfig>[0];

function model(
  supportedReasoningEfforts: string[],
  defaultReasoningEffort?: string,
  supportedContextTiers: ContextTier[] = [],
): ModelOptions {
  return {
    supportedReasoningEfforts,
    defaultReasoningEffort,
    supportedContextTiers,
  };
}

function tier(name: string, tokenWindow = 200_000): ContextTier {
  return { name, tokenWindow };
}

describe("model configuration", () => {
  test("preserves a requested effort when the selected model supports it", () => {
    const configuration = resolveModelConfigurationForModel(model(["low", "medium"], "medium"), {
      name: "gpt-5",
      reasoningEffort: "low",
    });

    expect(configuration).toEqual({
      name: "gpt-5",
      reasoningEffort: "low",
    });
  });

  test("falls back to the model default when the requested effort is missing or unsupported", () => {
    expect(
      resolveModelConfigurationForModel(model(["low", "medium", "high"], "medium"), {
        name: "gpt-5",
      }),
    ).toEqual({
      name: "gpt-5",
      reasoningEffort: "medium",
    });

    expect(
      resolveModelConfigurationForModel(model(["low", "medium", "high"], "medium"), {
        name: "gpt-5",
        reasoningEffort: "max",
      }),
    ).toEqual({
      name: "gpt-5",
      reasoningEffort: "medium",
    });
  });

  test("falls back to the first supported effort when the model has no default", () => {
    const configuration = resolveModelConfigurationForModel(model(["none", "max"]), {
      name: "gpt-5",
    });

    expect(configuration).toEqual({
      name: "gpt-5",
      reasoningEffort: "none",
    });
  });

  test("leaves reasoning effort unset when the model exposes no reasoning efforts", () => {
    const configuration = resolveModelConfigurationForModel(model([]), {
      name: "gpt-5",
      reasoningEffort: "medium",
    });

    expect(configuration).toEqual({ name: "gpt-5" });
  });

  test("preserves, defaults, and removes open context-tier names", () => {
    const configuration = { name: "gpt-5", reasoningEffort: "low" };
    const contextModel = model(["low"], "low", [tier("default"), tier("future_tier", 1_000_000)]);

    expect(
      resolveModelConfigurationForModel(contextModel, {
        ...configuration,
        contextTier: "future_tier",
      }),
    ).toEqual({
      ...configuration,
      contextTier: "future_tier",
    });

    expect(
      resolveModelConfigurationForModel(contextModel, {
        ...configuration,
        contextTier: "removed_tier",
      }),
    ).toEqual({
      ...configuration,
      contextTier: "default",
    });

    expect(
      resolveModelConfigurationForModel(model(["low"], "low"), {
        ...configuration,
        contextTier: "future_tier",
      }),
    ).toEqual(configuration);
  });

  test("casts open option strings only when building SDK commands", () => {
    const configuration = {
      name: "gpt-5",
      reasoningEffort: "max",
      contextTier: "future_tier",
    };

    expect(toSdkSetModelOptions(configuration) as unknown).toEqual({
      reasoningEffort: "max",
      contextTier: "future_tier",
    });
    expect(toSdkSessionModelOptions(configuration) as unknown).toEqual({
      model: "gpt-5",
      reasoningEffort: "max",
      contextTier: "future_tier",
    });
  });

  test("formats open-ended reasoning efforts for display", () => {
    expect(formatReasoningEffort("xhigh")).toBe("Extra High");
    expect(formatReasoningEffort("max")).toBe("Max");
    expect(formatReasoningEffort("very_high")).toBe("Very High");
  });

  test("normalizes a possibly stale configuration to the model catalog", () => {
    const configuration = normalizeModelConfiguration(
      [
        {
          id: "gpt-5",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
          supportedContextTiers: [tier("default"), tier("future_tier", 1_000_000)],
        },
        {
          id: "gpt-5.5",
          supportedReasoningEfforts: ["max"],
          defaultReasoningEffort: "max",
        },
      ],
      {
        name: "removed-model",
        reasoningEffort: "high",
        contextTier: "removed_tier",
        contextWindow: "long",
      } as Parameters<typeof normalizeModelConfiguration>[1],
    );

    expect(configuration as unknown).toEqual({
      name: "gpt-5",
      reasoningEffort: "low",
      contextTier: "default",
      contextWindow: "long",
    });
  });

  test("parses and compares configuration objects without dropping future properties", () => {
    const configuration = parseSerializedModelConfiguration(
      JSON.stringify({
        name: "gpt-5",
        reasoningEffort: "high",
        contextTier: "future_tier",
        contextWindow: "long",
      }),
    );

    expect(configuration as unknown).toEqual({
      name: "gpt-5",
      reasoningEffort: "high",
      contextTier: "future_tier",
      contextWindow: "long",
    });
    expect(
      areModelConfigurationsEqual(configuration, {
        name: "gpt-5",
        reasoningEffort: "high",
        contextTier: "future_tier",
        contextWindow: "long",
      } as typeof configuration),
    ).toBe(true);
    expect(
      areModelConfigurationsEqual(configuration, {
        name: "gpt-5",
        reasoningEffort: "high",
        contextTier: "default",
        contextWindow: "long",
      } as typeof configuration),
    ).toBe(false);
  });
});
