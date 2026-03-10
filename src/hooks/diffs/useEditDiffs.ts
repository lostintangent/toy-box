import { useMemo, useRef } from "react";
import type { Message, ToolCall } from "@/types";
import { toRelativePath } from "@/lib/utils";

export interface LineDiff {
  added: number;
  removed: number;
}

export interface FileDiff {
  path: string;
  displayPath: string;
  diff: LineDiff;
}

export interface SessionDiffs {
  total: LineDiff;
  byFile: FileDiff[];
  byToolCallId: Map<string, LineDiff>;
}

/** Compute actual added/removed line counts by finding common prefix/suffix */
export function computeLineDiff(oldStr: string, newStr: string): LineDiff {
  if (!oldStr && !newStr) return { added: 0, removed: 0 };
  if (!oldStr) return { added: newStr.split("\n").length, removed: 0 };
  if (!newStr) return { added: 0, removed: oldStr.split("\n").length };

  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Find common prefix length
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix length (but don't overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // The changed region is what's left after removing common prefix and suffix
  const removedCount = oldLines.length - prefixLen - suffixLen;
  const addedCount = newLines.length - prefixLen - suffixLen;

  return { added: Math.max(0, addedCount), removed: Math.max(0, removedCount) };
}

/** Check if a tool call is a completed edit operation */
function isCompletedEditToolCall(toolCall: ToolCall): boolean {
  const isEdit = toolCall.toolName === "edit" || toolCall.toolName === "replace_string_in_file";
  // Only include completed tool calls (have a result) to avoid computing diffs on partial streaming data
  return isEdit && toolCall.result !== undefined;
}

/** Extract path from edit tool call arguments */
function getEditPath(toolCall: ToolCall): string {
  return (
    (toolCall.arguments.path as string) || (toolCall.arguments.filePath as string) || "Unknown file"
  );
}

/** Extract old/new strings from edit tool call arguments */
function getEditStrings(toolCall: ToolCall): { oldStr: string; newStr: string } {
  const oldStr =
    (toolCall.arguments.old_str as string) || (toolCall.arguments.oldString as string) || "";
  const newStr =
    (toolCall.arguments.new_str as string) || (toolCall.arguments.newString as string) || "";
  return { oldStr, newStr };
}

/** Compute all edit diffs for a session (incremental - only computes new diffs) */
function computeSessionDiffs(
  messages: Message[],
  cache: Map<string, { path: string; diff: LineDiff }>,
  cwd?: string,
): SessionDiffs {
  const byToolCallId = new Map<string, LineDiff>();
  const fileAccumulator = new Map<string, { path: string; displayPath: string; diff: LineDiff }>();

  let totalAdded = 0;
  let totalRemoved = 0;

  for (const message of messages) {
    if (message.role !== "assistant" || !message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      if (!isCompletedEditToolCall(toolCall)) continue;

      const toolCallId = toolCall.toolCallId;
      let path: string;
      let diff: LineDiff;

      // Check cache first to avoid recomputing
      const cached = cache.get(toolCallId);
      if (cached) {
        path = cached.path;
        diff = cached.diff;
      } else {
        // Compute and cache
        path = getEditPath(toolCall);
        const { oldStr, newStr } = getEditStrings(toolCall);
        diff = computeLineDiff(oldStr, newStr);
        cache.set(toolCallId, { path, diff });
      }

      // Store by tool call ID
      byToolCallId.set(toolCallId, diff);

      // Accumulate by file
      const existing = fileAccumulator.get(path);
      if (existing) {
        existing.diff.added += diff.added;
        existing.diff.removed += diff.removed;
      } else {
        fileAccumulator.set(path, {
          path,
          displayPath: toRelativePath(path, cwd),
          diff: { added: diff.added, removed: diff.removed },
        });
      }

      // Accumulate total
      totalAdded += diff.added;
      totalRemoved += diff.removed;
    }
  }

  return {
    total: { added: totalAdded, removed: totalRemoved },
    byFile: Array.from(fileAccumulator.values()),
    byToolCallId,
  };
}

/**
 * Hook to compute edit diffs at session, file, and tool-call levels.
 *
 * Optimized for performance:
 * - Caches individual tool call diffs to avoid recomputation
 * - Only computes diffs for newly completed edit tool calls
 * - Safe for use in multi-session grid views
 */
export function useEditDiffs(messages: Message[], cwd?: string): SessionDiffs {
  // Persistent cache of computed diffs by tool call ID
  const cacheRef = useRef(new Map<string, { path: string; diff: LineDiff }>());

  return useMemo(() => computeSessionDiffs(messages, cacheRef.current, cwd), [messages, cwd]);
}
