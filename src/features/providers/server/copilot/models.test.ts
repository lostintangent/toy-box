import { describe, expect, test } from "bun:test";
import type { Model as ModelInfo } from "@microsoft/copilot-sdk";
import { toModelInfo } from "./models";

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "grok-4.6",
    name: "Grok 4.6",
    capabilities: {
      supports: { vision: false, reasoningEffort: true },
      limits: {
        max_context_window_tokens: 500_000,
        max_prompt_tokens: 372_000,
      },
    },
    supportedReasoningEfforts: ["low", "high"],
    defaultReasoningEffort: "high",
    ...overrides,
  };
}

describe("model catalog adapter", () => {
  test("derives tier windows from billing prompt allowances", () => {
    const billing = {
      tokenPrices: {
        maxPromptTokens: 200_000,
        longContext: { maxPromptTokens: 500_000 },
      },
    };

    expect(toModelInfo(model({ billing }))).toEqual({
      id: "grok-4.6",
      name: "Grok 4.6",
      provider: "copilot",
      supportedReasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
      supportedContextTiers: [
        { name: "default", tokenWindow: 200_000 },
        { name: "long_context", tokenWindow: 500_000 },
      ],
    });
  });

  test("leaves models without long-context metadata tierless", () => {
    const billing = { tokenPrices: { maxPromptTokens: 272_000 } };

    expect(toModelInfo(model({ billing })).supportedContextTiers).toBeUndefined();
  });
});
