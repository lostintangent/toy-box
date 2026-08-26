import { describe, expect, test } from "bun:test";
import { adaptModelCatalog, type ModelCatalogInfo } from "./useModels";

function model(overrides: Partial<ModelCatalogInfo> = {}): ModelCatalogInfo {
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
    ...overrides,
  };
}

describe("model catalog adapter", () => {
  test("derives total tier windows from billing and capability limits", () => {
    const billing = {
      tokenPrices: {
        maxPromptTokens: 200_000,
        longContext: { maxPromptTokens: 500_000 },
      },
    };

    const [adapted] = adaptModelCatalog([model({ billing })]);

    expect(adapted).toEqual({
      ...model({ billing }),
      supportedContextTiers: [
        { name: "default", tokenWindow: 328_000 },
        { name: "long_context", tokenWindow: 500_000 },
      ],
    });
  });

  test("leaves models without long-context metadata tierless", () => {
    const source = model();
    const [adapted] = adaptModelCatalog([source]);

    expect(adapted).toBe(source);
  });

  test("preserves pre-adapted tiers unchanged", () => {
    const source = model({
      supportedContextTiers: [
        { name: "default", tokenWindow: 264_000 },
        { name: "future_tier", tokenWindow: 2_000_000 },
      ],
    });
    const [adapted] = adaptModelCatalog([source]);

    expect(adapted).toBe(source);
  });
});
