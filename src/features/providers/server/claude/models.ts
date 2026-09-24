import type { ModelInfo as ClaudeModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ModelInfo } from "@providers/model";

export function toModelInfo(model: ClaudeModelInfo): ModelInfo {
  const id = normalizeModelId(model.resolvedModel ?? model.value);
  const name = model.displayName.replace(/ \(1M context\)$/, "");
  const version = id.match(/^claude-[a-z]+-(\d+(?:-\d{1,2})?)(?=-|\[|$)/)?.[1];
  return {
    id,
    name: version
      ? name.replace(/^(\w+)(?: \d+(?:\.\d+)?)?/, `$1 ${version.replace("-", ".")}`)
      : name,
    provider: "claude",
    supportedReasoningEfforts: model.supportedEffortLevels,
  };
}

// The catalog and startup can include [1m]; assistant messages and history omit it.
export function normalizeModelId(id: string): string {
  return id.replace(/\[1m\]$/i, "");
}
