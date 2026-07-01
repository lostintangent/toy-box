import { useMemo, useRef } from "react";
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

type CachedToolDiff = {
  cwd?: string;
} & ReturnType<typeof computeFileDiffStats>;

function isFileDiffToolCall(toolCall: ToolCall): boolean {
  return toolCall.name === "edit" || toolCall.name === "patch";
}

function computeToolDiff(
  toolCall: ToolCall,
  cache: Map<string, CachedToolDiff>,
  cwd?: string,
): CachedToolDiff | undefined {
  if (!isFileDiffToolCall(toolCall) || toolCall.result?.success !== true) {
    cache.delete(toolCall.id);
    return undefined;
  }

  const cached = cache.get(toolCall.id);
  if (cached && cached.cwd === cwd) return cached;

  const fileDiffs = getToolCallFileDiffs(toolCall, cwd);
  if (!fileDiffs) return undefined;

  const diff = computeFileDiffStats(fileDiffs);
  const next = { cwd, total: diff.total, byFile: diff.byFile };
  cache.set(toolCall.id, next);
  return next;
}

export function computeSessionDiffs(
  messages: Message[],
  cache: Map<string, CachedToolDiff>,
  cwd?: string,
): SessionDiffs {
  const byToolCallId = new Map<string, DiffStats>();
  const fileAccumulator = new Map<string, { path: string; displayPath: string; diff: DiffStats }>();

  let totalAdded = 0;
  let totalRemoved = 0;

  for (const message of messages) {
    if (message.role !== "assistant" || !message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      const toolDiff = computeToolDiff(toolCall, cache, cwd);
      if (!toolDiff) continue;

      byToolCallId.set(toolCall.id, toolDiff.total);

      for (const file of toolDiff.byFile) {
        const existing = fileAccumulator.get(file.path);
        if (existing) {
          existing.diff.added += file.diff.added;
          existing.diff.removed += file.diff.removed;
        } else {
          fileAccumulator.set(file.path, {
            path: file.path,
            displayPath: toRelativePath(file.path, cwd),
            diff: { added: file.diff.added, removed: file.diff.removed },
          });
        }
      }

      totalAdded += toolDiff.total.added;
      totalRemoved += toolDiff.total.removed;
    }
  }

  return {
    total: { added: totalAdded, removed: totalRemoved },
    byFile: Array.from(fileAccumulator.values()),
    byToolCallId,
  };
}

/**
 * Hook to compute diff stats at session, file, and tool-call levels.
 *
 * Tool-specific adapters convert edit/patch calls into file diffs before stats
 * are computed.
 */
export function useEditDiffs(messages: Message[], cwd?: string): SessionDiffs {
  const cacheRef = useRef(new Map<string, CachedToolDiff>());

  return useMemo(() => computeSessionDiffs(messages, cacheRef.current, cwd), [messages, cwd]);
}
