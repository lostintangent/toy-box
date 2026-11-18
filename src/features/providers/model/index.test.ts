import { describe, expect, test } from "bun:test";
import {
  areModelConfigurationsEqual,
  modelConfiguration,
  formatReasoningEffort,
  normalizeModelConfiguration,
  parseSerializedModelConfiguration,
  type ContextTier,
} from "./index";

function model(
  supportedReasoningEfforts: string[],
  defaultReasoningEffort?: string,
  supportedContextTiers: ContextTier[] = [],
): Parameters<typeof modelConfiguration>[0] {
  return {
    id: "gpt-5",
    provider: "copilot",
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
    const configuration = modelConfiguration(model(["low", "medium"], "medium"), {
      reasoningEffort: "low",
    });

    expect(configuration).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "low",
    });
  });

  test("falls back to the model default when the requested effort is missing or unsupported", () => {
    expect(modelConfiguration(model(["low", "medium", "high"], "medium"))).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "medium",
    });

    expect(
      modelConfiguration(model(["low", "medium", "high"], "medium"), { reasoningEffort: "max" }),
    ).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "medium",
    });
  });

  test("falls back to the first supported effort when the model has no default", () => {
    const configuration = modelConfiguration(model(["none", "max"]));

    expect(configuration).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "none",
    });
  });

  test("leaves reasoning effort unset when the model exposes no reasoning efforts", () => {
    const configuration = modelConfiguration(model([]), { reasoningEffort: "medium" });

    expect(configuration).toEqual({ provider: "copilot", name: "gpt-5" });
  });

  test("preserves, defaults, and removes open context-tier names", () => {
    const configuration = { provider: "copilot", name: "gpt-5", reasoningEffort: "low" };
    const contextModel = model(["low"], "low", [tier("default"), tier("future_tier", 1_000_000)]);

    expect(
      modelConfiguration(contextModel, { ...configuration, contextTier: "future_tier" }),
    ).toEqual({
      ...configuration,
      contextTier: "future_tier",
    });

    expect(
      modelConfiguration(contextModel, { ...configuration, contextTier: "removed_tier" }),
    ).toEqual({
      ...configuration,
      contextTier: "default",
    });

    expect(
      modelConfiguration(model(["low"], "low"), { ...configuration, contextTier: "future_tier" }),
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
      },
    );

    expect(configuration).toEqual({
      provider: "copilot",
      name: "gpt-5",
      reasoningEffort: "low",
      contextTier: "default",
    });
  });

  test("round-trips a serialized configuration and compares each of its options", () => {
    const expected = {
      provider: "future-provider",
      name: "future-model",
      reasoningEffort: "high",
      contextTier: "future_tier",
    };
    const configuration = parseSerializedModelConfiguration(JSON.stringify(expected));
    expect(configuration).toEqual(expected);
    expect(areModelConfigurationsEqual(configuration, { ...configuration! })).toBe(true);
    expect(
      areModelConfigurationsEqual(configuration, { ...configuration!, contextTier: "default" }),
    ).toBe(false);
  });
});
