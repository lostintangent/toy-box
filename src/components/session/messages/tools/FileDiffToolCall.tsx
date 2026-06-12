import React, { memo, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { ThemedToken } from "shiki/core";
import type { ToolCallProps } from "./types";
import { useToolCallDiff } from "@/hooks/diffs/EditDiffsContext";
import { useSessionCwd } from "@/hooks/session/SessionCwdContext";
import { getToolCallFileDiffs, type DiffHunk, type FileDiff } from "@/lib/diffs/fileDiffs";
import { toRelativePath } from "@/lib/utils";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

type Segment = { text: string; type: "same" | "added" | "removed" };

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

const STATUS_LABELS = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
} as const;

function computeCharDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: Segment[]; newSegments: Segment[] } {
  let prefixLen = 0;
  while (
    prefixLen < oldLine.length &&
    prefixLen < newLine.length &&
    oldLine[prefixLen] === newLine[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLine.length - prefixLen &&
    suffixLen < newLine.length - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = oldLine.slice(0, prefixLen);
  const oldMiddle = oldLine.slice(prefixLen, oldLine.length - suffixLen);
  const newMiddle = newLine.slice(prefixLen, newLine.length - suffixLen);
  const suffix = oldLine.slice(oldLine.length - suffixLen);

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

function computeMinIndent(diffLines: DiffLine[]): number {
  let minIndent = Infinity;

  for (const line of diffLines) {
    if (line.content.trim()) {
      const match = line.content.match(/^[ \t]*/);
      const indent = match ? match[0].length : 0;
      if (indent === 0) return 0;
      minIndent = Math.min(minIndent, indent);
    }

    if (line.type === "modified" && line.newContent.trim()) {
      const match = line.newContent.match(/^[ \t]*/);
      const indent = match ? match[0].length : 0;
      if (indent === 0) return 0;
      minIndent = Math.min(minIndent, indent);
    }
  }

  return minIndent === Infinity ? 0 : minIndent;
}

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

function computeIntuitiveDiff(oldText: string, newText: string): DiffResult {
  if (!oldText && !newText) return { lines: [], minIndent: 0 };

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const result: DiffLine[] = [];

  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: "context", content: oldLines[i] });
  }

  const oldMiddleStart = prefixLen;
  const oldMiddleEnd = oldLines.length - suffixLen;
  const newMiddleStart = prefixLen;
  const newMiddleEnd = newLines.length - suffixLen;
  const oldMiddleCount = oldMiddleEnd - oldMiddleStart;
  const newMiddleCount = newMiddleEnd - newMiddleStart;

  if (oldMiddleCount === newMiddleCount && oldMiddleCount > 0) {
    for (let i = 0; i < oldMiddleCount; i++) {
      const oldLine = oldLines[oldMiddleStart + i];
      const newLine = newLines[newMiddleStart + i];

      if (oldLine === newLine) {
        result.push({ type: "context", content: oldLine });
      } else {
        const { oldSegments, newSegments } = computeCharDiff(oldLine, newLine);
        result.push({
          type: "modified",
          content: oldLine,
          segments: oldSegments,
          newContent: newLine,
          newSegments,
        });
      }
    }
  } else {
    for (let i = oldMiddleStart; i < oldMiddleEnd; i++) {
      result.push({ type: "removed", content: oldLines[i] });
    }
    for (let i = newMiddleStart; i < newMiddleEnd; i++) {
      result.push({ type: "added", content: newLines[i] });
    }
  }

  for (let i = oldLines.length - suffixLen; i < oldLines.length; i++) {
    result.push({ type: "context", content: oldLines[i] });
  }

  const minIndent = computeMinIndent(result);
  return { lines: stripCommonIndent(result, minIndent), minIndent };
}

function diffLinesFromChangeLines(changeLines: NonNullable<DiffHunk["lines"]>): DiffResult {
  const diffLines: DiffLine[] = changeLines.map((line) => ({
    type: line.type,
    content: line.text,
  }));

  const minIndent = computeMinIndent(diffLines);
  return { lines: stripCommonIndent(diffLines, minIndent), minIndent };
}

function getSegmentClasses(type: Segment["type"], hasTokenColor: boolean): string {
  if (type === "same") {
    return hasTokenColor ? "" : "text-muted-foreground";
  }
  if (type === "removed") {
    return hasTokenColor
      ? DIFF_COLORS.removed.bgStrong
      : `${DIFF_COLORS.removed.bgStrong} ${DIFF_COLORS.removed.text}`;
  }
  return hasTokenColor
    ? DIFF_COLORS.added.bgStrong
    : `${DIFF_COLORS.added.bgStrong} ${DIFF_COLORS.added.text}`;
}

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

function renderSegmentsWithTokens(segments: Segment[], tokens: ThemedToken[] | undefined) {
  if (!tokens || tokens.length === 0) {
    return segments.map((seg, i) => (
      // eslint-disable-next-line react/no-array-index-key -- segments have no stable ID
      <span key={i} className={getSegmentClasses(seg.type, false)}>
        {seg.text}
      </span>
    ));
  }

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

  return <div>{renderTokens(line.tokens, content)}</div>;
}

const DiffView = memo(function DiffView({ diffLines }: { diffLines: DiffLine[] }) {
  return (
    <pre className="text-xs p-2 rounded overflow-x-auto max-h-64 font-mono bg-muted/50">
      <div className="inline-block min-w-full">
        {diffLines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key -- diff rows are a positional rendering of one computed diff
          <React.Fragment key={`${line.type}-${index}`}>
            <DiffLineRenderer line={line} />
          </React.Fragment>
        ))}
      </div>
    </pre>
  );
});

function useSyntaxHighlightedDiff(
  diffLines: DiffLine[],
  oldText: string,
  newText: string,
  path: string,
  minIndent: number,
): DiffLine[] {
  const [highlightedLines, setHighlightedLines] = useState<DiffLine[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      const { highlightCode, getLangFromPath } = await import("@/lib/diffs/highlight");
      const lang = getLangFromPath(path);

      const [oldHighlighted, newHighlighted] = await Promise.all([
        highlightCode(oldText, lang),
        highlightCode(newText, lang),
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
  }, [diffLines, oldText, newText, path, minIndent]);

  return highlightedLines ?? diffLines;
}

function DiffHunkView({ hunk, path }: { hunk: DiffHunk; path: string }) {
  const { lines: diffLines, minIndent } = useMemo(
    () =>
      hunk.lines
        ? diffLinesFromChangeLines(hunk.lines)
        : computeIntuitiveDiff(hunk.oldText, hunk.newText),
    [hunk.lines, hunk.oldText, hunk.newText],
  );
  const displayDiffLines = useSyntaxHighlightedDiff(
    diffLines,
    hunk.oldText,
    hunk.newText,
    path,
    minIndent,
  );

  return <DiffView diffLines={displayDiffLines} />;
}

function FileDiffHeader({ file, cwd }: { file: FileDiff; cwd?: string }) {
  const statusClass =
    file.status === "added"
      ? "text-diff-added"
      : file.status === "deleted"
        ? "text-diff-removed"
        : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs border-b border-border/50 bg-muted/30">
      <span className="truncate flex-1 font-mono text-muted-foreground">
        {toRelativePath(file.path, cwd)}
      </span>
      <span className={statusClass}>{STATUS_LABELS[file.status]}</span>
    </div>
  );
}

function FileDiffView({
  file,
  cwd,
  showHeader,
}: {
  file: FileDiff;
  cwd?: string;
  showHeader: boolean;
}) {
  if (file.hunks.length === 0) {
    return (
      <div>
        {showHeader && <FileDiffHeader file={file} cwd={cwd} />}
        <div className="p-2 text-xs text-muted-foreground">
          {STATUS_LABELS[file.status]} {toRelativePath(file.path, cwd)}
        </div>
      </div>
    );
  }

  return (
    <div>
      {showHeader && <FileDiffHeader file={file} cwd={cwd} />}
      <div className={showHeader ? "p-2 space-y-2" : "space-y-2"}>
        {file.hunks.map((hunk, index) => (
          // eslint-disable-next-line react/no-array-index-key -- hunks are displayed in source order
          <DiffHunkView key={index} hunk={hunk} path={file.path} />
        ))}
      </div>
    </div>
  );
}

function FileDiffsView({ fileDiffs, cwd }: { fileDiffs: FileDiff[]; cwd?: string }) {
  const showFileHeaders = fileDiffs.length > 1 || fileDiffs.some((file) => file.hunks.length === 0);

  return (
    <div className={showFileHeaders ? "divide-y divide-border/50" : undefined}>
      {fileDiffs.map((file) => (
        <FileDiffView
          key={getFileDiffKey(file)}
          file={file}
          cwd={cwd}
          showHeader={showFileHeaders}
        />
      ))}
    </div>
  );
}

function getFileDiffKey(file: FileDiff): string {
  const hunkKey = file.hunks.map((hunk) => `${hunk.oldText}->${hunk.newText}`).join("|");
  return `${file.path}:${file.status}:${hunkKey}`;
}

function getFileDiffToolCallLabel(
  toolName: string,
  fileDiffs: FileDiff[] | undefined,
  cwd?: string,
): string {
  const isPatch = toolName === "patch";
  if (!fileDiffs?.length) {
    return isPatch ? "Patch" : "Edit";
  }

  if (fileDiffs.length === 1) {
    return toRelativePath(fileDiffs[0].path, cwd);
  }

  return isPatch ? `Patch - ${fileDiffs.length} files` : `${fileDiffs.length} files`;
}

export function FileDiffToolCall({ toolCall, ...props }: ToolCallProps) {
  const cwd = useSessionCwd();
  const fileDiffs = useMemo(() => getToolCallFileDiffs(toolCall, cwd), [toolCall, cwd]);
  const lineDiff = useToolCallDiff(toolCall.id);
  const patch = typeof toolCall.arguments.patch === "string" ? toolCall.arguments.patch : undefined;
  const fallbackContent =
    toolCall.result === undefined
      ? patch
      : (toolCall.result.details ?? toolCall.result.content ?? patch);
  const fallbackTitle = toolCall.result === undefined && patch ? "Patch" : "Result";

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
      label={getFileDiffToolCallLabel(toolCall.name, fileDiffs, cwd)}
      defaultExpanded={true}
      headerExtra={headerExtra}
      bodyClassName={fileDiffs?.length ? "p-0" : undefined}
    >
      {fileDiffs?.length ? (
        <FileDiffsView fileDiffs={fileDiffs} cwd={cwd} />
      ) : (
        <TextBlock title={fallbackTitle}>{fallbackContent}</TextBlock>
      )}
    </ToolCallCard>
  );
}
