import type { Model as SdkModel } from "@microsoft/copilot-sdk";
import type { ContextTier, ModelInfo } from "@providers/model";

export function toModelInfo(model: SdkModel): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    provider: "copilot",
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedContextTiers: contextTiers(model),
  };
}

/** Billing advertises each tier's prompt allowance; the runtime reports the same context limit. */
function contextTiers({ billing }: SdkModel): ContextTier[] | undefined {
  const defaultTokens = billing?.tokenPrices?.maxPromptTokens;
  const longContextTokens = billing?.tokenPrices?.longContext?.maxPromptTokens;
  if (defaultTokens === undefined || longContextTokens === undefined) return undefined;

  return [
    { name: "default", tokenWindow: defaultTokens },
    { name: "long_context", tokenWindow: longContextTokens },
  ];
}
