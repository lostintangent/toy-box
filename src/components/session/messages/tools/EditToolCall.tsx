import React, { useMemo, useEffect, useState, memo } from "react";
import { Pencil } from "lucide-react";
import type { ThemedToken } from "shiki/core";
import type { ToolCallProps } from "./types";
import { useToolCallDiff } from "@/hooks/diffs/EditDiffsContext";
import { toRelativePath } from "@/lib/utils";
import { useSessionCwd } from "@/hooks/session/SessionCwdContext";
import { ToolCallCard } from "./ToolCallCard";

// ============================================================================
// Types
// ============================================================================

type Segment = { text: string; type: "same" | "added" | "removed" };

/** Discriminated union for diff lines - TypeScript knows segments exist when type is "modified" */
type DiffLine =
  | { type: "context"; content: string; tokens?: ThemedToken[] }
  | { type: "added"; content: string; tokens?: ThemedToken[] }
  | { type: "removed"; content: string; tokens?: ThemedToken[] }
  | {
      type: "modified";
      content: string;
      newContent: string;
      segments: Segment[];
      newSegments: Segment[];
      tokens?: ThemedToken[];
      newTokens?: ThemedToken[];
    };

interface DiffResult {
  lines: DiffLine[];
  minIndent: number;
}

// ============================================================================
// Style Constants
// ============================================================================

const DIFF_COLORS = {
  added: {
    bg: "bg-diff-added-bg",
    bgStrong: "bg-diff-added-bg-strong",
    text: "text-diff-added",
  },
  removed: {
    bg: "bg-diff-removed-bg",
    bgStrong: "bg-diff-removed-bg-strong",
    text: "text-diff-removed",
  },
  modified: {
    oldBg: "bg-diff-modified-old-bg",
    newBg: "bg-diff-modified-new-bg",
  },
} as const;

// ============================================================================
// Diff Computation
// ============================================================================

/**
 * Compute character-level diff between two strings.
 * Returns segments for rendering inline highlights.
 */
function computeCharDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: Segment[]; newSegments: Segment[] } {
  // Find common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldLine.length &&
    prefixLen < newLine.length &&
    oldLine[prefixLen] === newLine[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix (don't overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < oldLine.length - prefixLen &&
    suffixLen < newLine.length - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Extract the three parts - prefix and suffix are shared, middle differs
  const prefix = oldLine.slice(0, prefixLen);
  const oldMiddle = oldLine.slice(prefixLen, oldLine.length - suffixLen);
  const newMiddle = newLine.slice(prefixLen, newLine.length - suffixLen);
  const suffix = oldLine.slice(oldLine.length - suffixLen);

  // Build segments, only including non-empty parts
  const oldSegments: Segment[] = [];
  const newSegments: Segment[] = [];

  if (prefix) {
    oldSegments.push({ text: prefix, type: "same" });
    newSegments.push({ text: prefix, type: "same" });
  }
  if (oldMiddle) oldSegments.push({ text: oldMiddle, type: "removed" });
  if (newMiddle) newSegments.push({ text: newMiddle, type: "added" });
  if (suffix) {
    oldSegments.push({ text: suffix, type: "same" });
    newSegments.push({ text: suffix, type: "same" });
  }

  return { oldSegments, newSegments };
}

/**
 * Compute the minimum leading whitespace across all non-empty lines.
 * Iterates without creating intermediate arrays for performance.
 */
function computeMinIndent(diffLines: DiffLine[]): number {
  let minIndent = Infinity;

  for (const line of diffLines) {
    // Check main content
    if (line.content.trim()) {
      const match = line.content.match(/^[ \t]*/);
      const indent = match ? match[0].length : 0;
      if (indent === 0) return 0;
      minIndent = Math.min(minIndent, indent);
    }

    // Check newContent for modified lines
    if (line.type === "modified" && line.newContent.trim()) {
      const match = line.newContent.match(/^[ \t]*/);
      const indent = match ? match[0].length : 0;
      if (indent === 0) return 0;
      minIndent = Math.min(minIndent, indent);
    }
  }

  return minIndent === Infinity ? 0 : minIndent;
}

/**
 * Strip a fixed number of leading characters from diff lines.
 * For modified lines, recomputes character-level diff after stripping.
 */
function stripCommonIndent(diffLines: DiffLine[], indent: number): DiffLine[] {
  if (indent === 0) return diffLines;

  return diffLines.map((line): DiffLine => {
    const strippedContent = line.content.slice(indent);

    if (line.type === "modified") {
      const strippedNewContent = line.newContent.slice(indent);
      const { oldSegments, newSegments } = computeCharDiff(strippedContent, strippedNewContent);
      return {
        ...line,
        content: strippedContent,
        newContent: strippedNewContent,
        segments: oldSegments,
        newSegments,
      };
    }

    return { ...line, content: strippedContent };
  });
}

/**
 * Compute an intuitive diff by finding common prefix/suffix lines.
 * When the number of changed lines match, uses inline character-level diffs.
 * Strips common leading whitespace for cleaner display.
 */
function computeIntuitiveDiff(oldStr: string, newStr: string): DiffResult {
  if (!oldStr && !newStr) return { lines: [], minIndent: 0 };

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

  const result: DiffLine[] = [];

  // Add context lines from prefix
  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: "context", content: oldLines[i] });
  }

  // Get middle sections
  const oldMiddleStart = prefixLen;
  const oldMiddleEnd = oldLines.length - suffixLen;
  const newMiddleStart = prefixLen;
  const newMiddleEnd = newLines.length - suffixLen;

  const oldMiddleCount = oldMiddleEnd - oldMiddleStart;
  const newMiddleCount = newMiddleEnd - newMiddleStart;

  // If same number of changed lines, use inline character diffs
  if (oldMiddleCount === newMiddleCount && oldMiddleCount > 0) {
    for (let i = 0; i < oldMiddleCount; i++) {
      const oldLine = oldLines[oldMiddleStart + i];
      const newLine = newLines[newMiddleStart + i];

      // If lines are identical (shouldn't happen but be safe), show as context
      if (oldLine === newLine) {
        result.push({ type: "context", content: oldLine });
      } else {
        const { oldSegments, newSegments } = computeCharDiff(oldLine, newLine);
        result.push({
          type: "modified",
          content: oldLine,
          segments: oldSegments,
          newContent: newLine,
          newSegments: newSegments,
        });
      }
    }
  } else {
    // Different line counts: fall back to line-by-line
    for (let i = oldMiddleStart; i < oldMiddleEnd; i++) {
      result.push({ type: "removed", content: oldLines[i] });
    }
    for (let i = newMiddleStart; i < newMiddleEnd; i++) {
      result.push({ type: "added", content: newLines[i] });
    }
  }

  // Add context lines from suffix
  for (let i = oldLines.length - suffixLen; i < oldLines.length; i++) {
    result.push({ type: "context", content: oldLines[i] });
  }

  // Strip common leading whitespace for cleaner display
  const minIndent = computeMinIndent(result);
  return { lines: stripCommonIndent(result, minIndent), minIndent };
}

// ============================================================================
// Rendering Helpers
// ============================================================================

/** Get the appropriate CSS classes for a segment type */
function getSegmentClasses(type: Segment["type"], hasTokenColor: boolean): string {
  if (type === "same") {
    return hasTokenColor ? "" : "text-muted-foreground";
  }
  if (type === "removed") {
    return hasTokenColor
      ? DIFF_COLORS.removed.bgStrong
      : `${DIFF_COLORS.removed.bgStrong} ${DIFF_COLORS.removed.text}`;
  }
  // added
  return hasTokenColor
    ? DIFF_COLORS.added.bgStrong
    : `${DIFF_COLORS.added.bgStrong} ${DIFF_COLORS.added.text}`;
}

/** Render tokens with syntax highlighting, or plain text fallback */
function renderTokens(tokens: ThemedToken[] | undefined, fallback: string) {
  if (!tokens) return fallback || "\u00A0";
  if (tokens.length === 0) return "\u00A0";

  return tokens.map((token, i) => (
    // eslint-disable-next-line react/no-array-index-key -- tokens have no stable ID
    <span key={i} style={{ color: token.color }}>
      {token.content}
    </span>
  ));
}

/**
 * Render segments with syntax-aware highlighting.
 * Merges syntax tokens with diff segments for proper coloring.
 */
function renderSegmentsWithTokens(segments: Segment[], tokens: ThemedToken[] | undefined) {
  // No syntax tokens - use simple segment rendering
  if (!tokens || tokens.length === 0) {
    return segments.map((seg, i) => (
      // eslint-disable-next-line react/no-array-index-key -- segments have no stable ID
      <span key={i} className={getSegmentClasses(seg.type, false)}>
        {seg.text}
      </span>
    ));
  }

  // Merge syntax tokens with diff segments
  const result: React.ReactNode[] = [];
  let tokenIdx = 0;
  let tokenOffset = 0;
  let linePos = 0;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    const segStart = linePos;
    const segEnd = linePos + seg.text.length;

    while (linePos < segEnd && tokenIdx < tokens.length) {
      const token = tokens[tokenIdx];
      const takeLen = Math.min(token.content.length - tokenOffset, segEnd - linePos);
      const text = token.content.slice(tokenOffset, tokenOffset + takeLen);

      if (text) {
        result.push(
          <span
            key={`${segIdx}-${result.length}`}
            style={{ color: token.color }}
            className={getSegmentClasses(seg.type, true)}
          >
            {text}
          </span>,
        );
      }

      linePos += takeLen;
      tokenOffset += takeLen;

      if (tokenOffset >= token.content.length) {
        tokenIdx++;
        tokenOffset = 0;
      }
    }

    // Fallback if tokens don't cover all text
    if (linePos < segEnd) {
      result.push(
        <span key={`${segIdx}-fallback`} className={getSegmentClasses(seg.type, false)}>
          {seg.text.slice(linePos - segStart)}
        </span>,
      );
      linePos = segEnd;
    }
  }

  return result;
}

/**
 * Strip leading whitespace from tokens.
 * Removes `indent` characters from the beginning of the token sequence.
 */
function stripTokensIndent(
  tokens: ThemedToken[] | undefined,
  indent: number,
): ThemedToken[] | undefined {
  if (!tokens || indent === 0) return tokens;

  const result: ThemedToken[] = [];
  let remaining = indent;

  for (const token of tokens) {
    if (remaining <= 0) {
      result.push(token);
    } else if (token.content.length <= remaining) {
      remaining -= token.content.length;
    } else {
      result.push({ ...token, content: token.content.slice(remaining) });
      remaining = 0;
    }
  }

  return result;
}

// ============================================================================
// Components
// ============================================================================

/** Render a single diff line based on its type */
function DiffLineRenderer({ line }: { line: DiffLine }) {
  if (line.type === "modified") {
    const hasOldContent = line.segments.some((s) => s.text.length > 0);
    const hasNewContent = line.newSegments.some((s) => s.text.length > 0);

    return (
      <>
        <div className={DIFF_COLORS.modified.oldBg}>
          {renderSegmentsWithTokens(line.segments, line.tokens)}
          {!hasOldContent && "\u00A0"}
        </div>
        <div className={DIFF_COLORS.modified.newBg}>
          {renderSegmentsWithTokens(line.newSegments, line.newTokens)}
          {!hasNewContent && "\u00A0"}
        </div>
      </>
    );
  }

  const content = line.content || "\u00A0";

  if (line.type === "added") {
    return <div className={DIFF_COLORS.added.bg}>{renderTokens(line.tokens, content)}</div>;
  }

  if (line.type === "removed") {
    return <div className={DIFF_COLORS.removed.bg}>{renderTokens(line.tokens, content)}</div>;
  }

  // context
  return <div>{renderTokens(line.tokens, content)}</div>;
}

/** Memoized diff view - prevents re-renders when parent updates but diffLines unchanged */
const DiffView = memo(function DiffView({ diffLines }: { diffLines: DiffLine[] }) {
  return (
    <pre className="text-xs p-2 rounded overflow-x-auto max-h-64 font-mono bg-muted/50">
      <div className="inline-block min-w-full">
        {diffLines.map((line, index) => (
          <React.Fragment key={`${line.type}-${index}`}>
            <DiffLineRenderer line={line} />
          </React.Fragment>
        ))}
      </div>
    </pre>
  );
});

// ============================================================================
// Hooks
// ============================================================================

/** Apply syntax highlighting to diff lines asynchronously */
function useSyntaxHighlightedDiff(
  diffLines: DiffLine[],
  oldStr: string,
  newStr: string,
  path: string,
  minIndent: number,
): DiffLine[] {
  const [highlightedLines, setHighlightedLines] = useState<DiffLine[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      const { highlightCode, getLangFromPath } = await import("@/lib/highlight");
      const lang = getLangFromPath(path);

      const [oldHighlighted, newHighlighted] = await Promise.all([
        highlightCode(oldStr, lang),
        highlightCode(newStr, lang),
      ]);

      if (cancelled) return;

      let oldLineIdx = 0;
      let newLineIdx = 0;

      const enhanced = diffLines.map((line): DiffLine => {
        const oldTokens = stripTokensIndent(oldHighlighted?.[oldLineIdx]?.tokens, minIndent);
        const newTokens = stripTokensIndent(newHighlighted?.[newLineIdx]?.tokens, minIndent);

        switch (line.type) {
          case "context":
            oldLineIdx++;
            newLineIdx++;
            return { ...line, tokens: oldTokens };

          case "removed":
            oldLineIdx++;
            return { ...line, tokens: oldTokens };

          case "added":
            newLineIdx++;
            return { ...line, tokens: newTokens };

          case "modified":
            oldLineIdx++;
            newLineIdx++;
            return { ...line, tokens: oldTokens, newTokens };
        }
      });

      setHighlightedLines(enhanced);
    }

    highlight();
    return () => {
      cancelled = true;
    };
  }, [diffLines, oldStr, newStr, path, minIndent]);

  return highlightedLines ?? diffLines;
}

// ============================================================================
// Main Component
// ============================================================================

export function EditToolCall({ toolCall, ...props }: ToolCallProps) {
  const cwd = useSessionCwd();
  // Extract arguments
  const path =
    (toolCall.arguments.path as string) ||
    (toolCall.arguments.filePath as string) ||
    "Unknown file";
  const oldStr =
    (toolCall.arguments.old_str as string) || (toolCall.arguments.oldString as string) || "";
  const newStr =
    (toolCall.arguments.new_str as string) || (toolCall.arguments.newString as string) || "";

  const lineDiff = useToolCallDiff(toolCall.toolCallId);

  // Compute diff (memoized)
  const { lines: diffLines, minIndent } = useMemo(
    () => computeIntuitiveDiff(oldStr, newStr),
    [oldStr, newStr],
  );

  // Apply syntax highlighting asynchronously
  const displayDiffLines = useSyntaxHighlightedDiff(diffLines, oldStr, newStr, path, minIndent);

  const headerExtra = lineDiff && (
    <span className="text-xs shrink-0">
      <span className="text-diff-added">+{lineDiff.added}</span>{" "}
      <span className="text-diff-removed">-{lineDiff.removed}</span>
    </span>
  );

  return (
    <ToolCallCard
      {...props}
      toolCall={toolCall}
      icon={Pencil}
      label={toRelativePath(path, cwd)}
      defaultExpanded={true}
      headerExtra={headerExtra}
      bodyClassName="p-0"
    >
      {(oldStr || newStr) && <DiffView diffLines={displayDiffLines} />}
    </ToolCallCard>
  );
}
