import { useState } from "react";
import type { Message, ToolCall } from "@/types";
import {
  computeDiffStats,
  computeFileDiffStats,
  getToolCallFileDiffs,
  type DiffStats,
} from "@/lib/diffs/fileDiffs";
import { toRelativePath } from "@/lib/paths";

export { computeDiffStats };
export type { DiffStats };

export interface FileDiffSummary {
  path: string;
  displayPath: string;
  diff: DiffStats;
}

export interface SessionDiffs {
  total: DiffStats;
  byFile: FileDiffSummary[];
  byToolCallId: Map<string, DiffStats>;
}

type ToolDiff = {
  cwd?: string;
  toolCall: ToolCall;
} & ReturnType<typeof computeFileDiffStats>;

function getFileDiffToolCalls(messages: Message[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !message.toolCalls) continue;
    for (const toolCall of message.toolCalls) {
      if (toolCall.name === "edit" || toolCall.name === "patch") toolCalls.push(toolCall);
    }
  }

  return toolCalls;
}

function computeToolDiff(
  toolCall: ToolCall,
  cache: Map<string, ToolDiff>,
  cwd?: string,
): ToolDiff | undefined {
  if (toolCall.result?.success !== true) {
    cache.delete(toolCall.id);
    return undefined;
  }

  const cached = cache.get(toolCall.id);
  if (cached && cached.cwd === cwd && cached.toolCall === toolCall) return cached;

  const fileDiffs = getToolCallFileDiffs(toolCall, cwd);
  if (!fileDiffs) return undefined;

  const diff = computeFileDiffStats(fileDiffs);
  const next = { cwd, toolCall, total: diff.total, byFile: diff.byFile };
  cache.set(toolCall.id, next);
  return next;
}

function summarizeSessionDiffs(
  toolCalls: ToolCall[],
  cwd: string | undefined,
  toolDiffs: Map<string, ToolDiff>,
): SessionDiffs {
  const byToolCallId = new Map<string, DiffStats>();
  const files = new Map<string, FileDiffSummary>();
  const total = { added: 0, removed: 0 };

  for (const toolCall of toolCalls) {
    const toolDiff = computeToolDiff(toolCall, toolDiffs, cwd);
    if (!toolDiff) continue;

    byToolCallId.set(toolCall.id, toolDiff.total);
    total.added += toolDiff.total.added;
    total.removed += toolDiff.total.removed;

    for (const file of toolDiff.byFile) {
      const existing = files.get(file.path);
      if (existing) {
        existing.diff.added += file.diff.added;
        existing.diff.removed += file.diff.removed;
      } else {
        files.set(file.path, {
          path: file.path,
          displayPath: toRelativePath(file.path, cwd),
          diff: { ...file.diff },
        });
      }
    }
  }

  return {
    total,
    byFile: Array.from(files.values()),
    byToolCallId,
  };
}

/** Computes diff totals for successful edit and patch tool calls. */
export function computeSessionDiffs(messages: Message[], cwd?: string): SessionDiffs {
  return summarizeSessionDiffs(getFileDiffToolCalls(messages), cwd, new Map());
}

type EditDiffCache = {
  toolCalls: ToolCall[];
  toolDiffs: Map<string, ToolDiff>;
  cwd?: string;
  result?: SessionDiffs;
};

function projectSessionDiffs(
  messages: Message[],
  cwd: string | undefined,
  cache: EditDiffCache,
): SessionDiffs {
  const toolCalls = getFileDiffToolCalls(messages);
  const inputsUnchanged =
    cache.cwd === cwd &&
    cache.toolCalls.length === toolCalls.length &&
    cache.toolCalls.every((toolCall, index) => toolCall === toolCalls[index]);

  if (cache.result && inputsUnchanged) return cache.result;

  const result = summarizeSessionDiffs(toolCalls, cwd, cache.toolDiffs);
  cache.toolCalls = toolCalls;
  cache.cwd = cwd;
  cache.result = result;
  return result;
}

/**
 * Projects edit diffs from a session transcript. Immutable tool-call identity
 * keeps the projection stable while unrelated text streams.
 */
export function useEditDiffs(messages: Message[], cwd?: string): SessionDiffs {
  const [cache] = useState<EditDiffCache>(() => ({ toolCalls: [], toolDiffs: new Map() }));
  return projectSessionDiffs(messages, cwd, cache);
}
