import { describe, expect, test } from "bun:test";
import {
  areModelConfigurationsEqual,
  formatReasoningEffort,
  getModelReasoningConfig,
  normalizeModelConfiguration,
  parseSerializedModelConfiguration,
  resolveModelConfigurationForModel,
  type ContextTier,
} from "./index";

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
  test("model configurations require an explicit provider", () => {
    expect(parseSerializedModelConfiguration(JSON.stringify({ name: "shared" }))).toBeNull();
  });
  test("identical native model names remain distinct across providers", () => {
    const catalog = [
      { id: "shared", provider: "copilot" },
      { id: "shared", provider: "codex" },
    ];
    expect(
      normalizeModelConfiguration(catalog, { name: "shared", provider: "codex" })?.provider,
    ).toBe("codex");
    expect(
      areModelConfigurationsEqual(
        { name: "shared", provider: "codex" },
        { name: "shared", provider: "copilot" },
      ),
    ).toBe(false);
    expect(
      normalizeModelConfiguration([{ id: "shared", provider: "copilot" }], {
        name: "shared",
        provider: "codex",
      })?.provider,
    ).toBe("copilot");
  });
  test("preserves a requested effort when the selected model supports it", () => {
    const configuration = resolveModelConfigurationForModel(model(["low", "medium"], "medium"), {
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "low",
    });

    expect(configuration).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "low",
    });
  });

  test("falls back to the model default when the requested effort is missing or unsupported", () => {
    expect(
      resolveModelConfigurationForModel(model(["low", "medium", "high"], "medium"), {
        provider: "copilot",
        name: "gpt-5",
      }),
    ).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "medium",
    });

    expect(
      resolveModelConfigurationForModel(model(["low", "medium", "high"], "medium"), {
        provider: "copilot",
        name: "gpt-5",
        reasoningEffort: "max",
      }),
    ).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "medium",
    });
  });

  test("falls back to the first supported effort when the model has no default", () => {
    const configuration = resolveModelConfigurationForModel(model(["none", "max"]), {
      provider: "copilot",
      name: "gpt-5",
    });

    expect(configuration).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "none",
    });
  });

  test("leaves reasoning effort unset when the model exposes no reasoning efforts", () => {
    const configuration = resolveModelConfigurationForModel(model([]), {
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "medium",
    });

    expect(configuration).toEqual({ provider: "copilot", name: "gpt-5" });
  });

  test("preserves, defaults, and removes open context-tier names", () => {
    const configuration = { provider: "copilot", name: "gpt-5", reasoningEffort: "low" };
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
          provider: "copilot",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
          supportedContextTiers: [tier("default"), tier("future_tier", 1_000_000)],
        },
        {
          id: "gpt-5.5",
          provider: "copilot",
          supportedReasoningEfforts: ["max"],
          defaultReasoningEffort: "max",
        },
      ],
      {
        provider: "copilot",
        name: "removed-model",
        reasoningEffort: "high",
        contextTier: "removed_tier",
        contextWindow: "long",
      } as Parameters<typeof normalizeModelConfiguration>[1],
    );

    expect(configuration as unknown).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "low",
      contextTier: "default",
      contextWindow: "long",
    });
  });

  test("round-trips nested options and compares top-level configuration changes", () => {
    const expected = {
      provider: "future-provider",
      name: "future-model",
      reasoningEffort: "high",
      contextTier: "future_tier",
      contextWindow: "long",
      options: { budget: 42, modes: ["fast", "accurate"], enabled: true, fallback: null },
    };
    const configuration = parseSerializedModelConfiguration(JSON.stringify(expected));
    expect(configuration).toEqual(expected);
    expect(areModelConfigurationsEqual(configuration, { ...configuration! })).toBe(true);
    expect(
      areModelConfigurationsEqual(configuration, { ...configuration!, contextTier: "default" }),
    ).toBe(false);
  });
});
