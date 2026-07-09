import { describe, expect, test } from "bun:test";
import {
  areModelConfigurationsEqual,
  formatReasoningEffort,
  getModelReasoningConfig,
  normalizeModelConfiguration,
  parseSerializedModelConfiguration,
  resolveModelConfigurationForModel,
} from "./modelConfiguration";

type ReasoningModel = Parameters<typeof getModelReasoningConfig>[0];

function model(
  supportedReasoningEfforts: string[],
  defaultReasoningEffort?: string,
): ReasoningModel {
  return {
    supportedReasoningEfforts,
    defaultReasoningEffort,
  };
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

    expect(configuration).toEqual({
      name: "gpt-5",
      reasoningEffort: undefined,
    });
  });

  test("formats open-ended effort values for display", () => {
    expect(formatReasoningEffort("xhigh")).toBe("Extra High");
    expect(formatReasoningEffort("max")).toBe("Max");
    expect(formatReasoningEffort("very_high")).toBe("Very High");
  });

  test("normalizes a possibly stale configuration to the model catalog", () => {
    const configuration = normalizeModelConfiguration(
      [
        { id: "gpt-5", supportedReasoningEfforts: ["low"], defaultReasoningEffort: "low" },
        { id: "gpt-5.5", supportedReasoningEfforts: ["max"], defaultReasoningEffort: "max" },
      ],
      { name: "removed-model", reasoningEffort: "high", contextWindow: "long" } as Parameters<
        typeof normalizeModelConfiguration
      >[1],
    );

    expect(configuration as unknown).toEqual({
      name: "gpt-5",
      reasoningEffort: "low",
      contextWindow: "long",
    });
  });

  test("parses and compares configuration objects without dropping future properties", () => {
    const configuration = parseSerializedModelConfiguration(
      JSON.stringify({
        name: "gpt-5",
        reasoningEffort: "high",
        contextWindow: "long",
      }),
    );

    expect(configuration as unknown).toEqual({
      name: "gpt-5",
      reasoningEffort: "high",
      contextWindow: "long",
    });
    expect(
      areModelConfigurationsEqual(configuration, {
        name: "gpt-5",
        reasoningEffort: "high",
        contextWindow: "long",
      } as typeof configuration),
    ).toBe(true);
    expect(
      areModelConfigurationsEqual(configuration, {
        name: "gpt-5",
        reasoningEffort: "high",
        contextWindow: "short",
      } as typeof configuration),
    ).toBe(false);
  });
});
