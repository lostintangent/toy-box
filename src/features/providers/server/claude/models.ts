import type { ModelInfo as ClaudeModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ModelInfo } from "@providers/model";

export function toModelInfo(model: ClaudeModelInfo): ModelInfo {
  return {
    id: normalizeModelId(model.resolvedModel ?? model.value),
    name: model.displayName,
    provider: "claude",
    supportedReasoningEfforts: model.supportedEffortLevels,
  };
}

// The catalog, startup, and turn usage can include [1m]; assistant messages and history omit it.
export function normalizeModelId(id: string): string {
  return id.replace(/\[1m\]$/i, "");
}
