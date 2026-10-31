import { startTransition, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import type { ThemedToken } from "shiki/core";
import type { ToolCallProps } from "./types";
import { useToolCallDiff } from "../../editDiffs";
import { useCurrentSession } from "../../../CurrentSessionContext";
import { getToolCallFileDiffs, type DiffHunk, type FileDiff } from "../../../../model/fileDiffs";
import { toRelativePath } from "@files/model/paths";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

type DiffLine = {
  type: DiffHunk["lines"][number]["type"];
  content: string;
  tokens?: ThemedToken[];
};

interface DiffRenderSource {
  lines: DiffLine[];
  minIndent: number;
  oldText: string;
  newText: string;
  path: string;
}

const DIFF_LINE_CLASSES = {
  context: undefined,
  added: "bg-diff-added-bg",
  removed: "bg-diff-removed-bg",
} as const;

const STATUS_LABELS = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
} as const;

function computeMinIndent(diffLines: DiffLine[]): number {
  let minIndent = Infinity;

  for (const line of diffLines) {
    if (line.content.trim()) {
      const match = line.content.match(/^[ \t]*/);
      const indent = match ? match[0].length : 0;
      if (indent === 0) return 0;
      minIndent = Math.min(minIndent, indent);
    }
  }

  return minIndent === Infinity ? 0 : minIndent;
}

function stripCommonIndent(diffLines: DiffLine[], indent: number): DiffLine[] {
  if (indent === 0) return diffLines;

  return diffLines.map((line) => ({ ...line, content: line.content.slice(indent) }));
}

function createDiffRenderSource(hunk: DiffHunk, path: string): DiffRenderSource {
  const lines = hunk.lines.map((line): DiffLine => ({ type: line.type, content: line.text }));
  const minIndent = computeMinIndent(lines);

  return {
    lines: stripCommonIndent(lines, minIndent),
    minIndent,
    oldText: hunk.oldText,
    newText: hunk.newText,
    path,
  };
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
  return (
    <div className={DIFF_LINE_CLASSES[line.type]}>{renderTokens(line.tokens, line.content)}</div>
  );
}

function DiffView({ diffLines }: { diffLines: DiffLine[] }) {
  return (
    <pre className="max-h-64 overflow-x-auto rounded bg-secondary-background p-2 font-mono text-xs">
      <div className="inline-block min-w-full">
        {diffLines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key -- diff rows are a positional rendering of one computed diff
          <DiffLineRenderer key={`${line.type}-${index}`} line={line} />
        ))}
      </div>
    </pre>
  );
}

async function highlightDiffLines(
  diffLines: DiffLine[],
  oldText: string,
  newText: string,
  path: string,
  minIndent: number,
): Promise<DiffLine[]> {
  const { getLangFromPath, highlightCode } = await import("@/shared/syntaxHighlight");
  const lang = getLangFromPath(path);
  const [oldHighlighted, newHighlighted] = await Promise.all([
    highlightCode(oldText, lang),
    highlightCode(newText, lang),
  ]);
  let oldLineIndex = 0;
  let newLineIndex = 0;

  return diffLines.map((line): DiffLine => {
    const oldTokens = stripTokensIndent(oldHighlighted?.[oldLineIndex]?.tokens, minIndent);
    const newTokens = stripTokensIndent(newHighlighted?.[newLineIndex]?.tokens, minIndent);

    switch (line.type) {
      case "context":
        oldLineIndex++;
        newLineIndex++;
        return { ...line, tokens: oldTokens };
      case "removed":
        oldLineIndex++;
        return { ...line, tokens: oldTokens };
      case "added":
        newLineIndex++;
        return { ...line, tokens: newTokens };
    }
  });
}

function useSyntaxHighlightedDiff(source: DiffRenderSource): DiffLine[] {
  const [highlightedLines, setHighlightedLines] = useState<DiffLine[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void highlightDiffLines(
      source.lines,
      source.oldText,
      source.newText,
      source.path,
      source.minIndent,
    ).then((enhanced) => {
      if (cancelled) return;
      startTransition(() => setHighlightedLines(enhanced));
    });

    return () => {
      cancelled = true;
    };
  }, [source]);

  return highlightedLines ?? source.lines;
}

function DiffHunkView({ hunk, path }: { hunk: DiffHunk; path: string }) {
  // FileDiffView keys this mounted state by hunk content, so async highlighting
  // cannot turn its own state update into another highlighting pass.
  const [source] = useState(() => createDiffRenderSource(hunk, path));
  const displayDiffLines = useSyntaxHighlightedDiff(source);

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
          <DiffHunkView
            // eslint-disable-next-line react/no-array-index-key -- content resets highlight state; index disambiguates identical hunks
            key={`${getDiffHunkKey(hunk)}:${index}`}
            hunk={hunk}
            path={file.path}
          />
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

function encodeKeyPart(value: string): string {
  return `${value.length}:${value}`;
}

function getDiffHunkKey(hunk: DiffHunk): string {
  const linesKey = hunk.lines.map((line) => `${line.type[0]}${encodeKeyPart(line.text)}`).join("");
  return `${encodeKeyPart(hunk.oldText)}>${encodeKeyPart(hunk.newText)}>${linesKey}`;
}

function getFileDiffKey(file: FileDiff): string {
  const hunkKey = file.hunks.map(getDiffHunkKey).join("|");
  return `${encodeKeyPart(file.path)}:${file.status}:${hunkKey}`;
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

  return isPatch ? `Edit (${fileDiffs.length} files)` : `${fileDiffs.length} files`;
}

export function FileDiffToolCall({ toolCall, ...props }: ToolCallProps) {
  const { cwd } = useCurrentSession();
  const fileDiffs = getToolCallFileDiffs(toolCall, cwd);
  const lineDiff = useToolCallDiff(toolCall.id);
  const patch = typeof toolCall.arguments.patch === "string" ? toolCall.arguments.patch : undefined;
  const argumentsText =
    Object.keys(toolCall.arguments).length > 0
      ? JSON.stringify(toolCall.arguments, null, 2)
      : undefined;
  const fallbackContent =
    toolCall.result === undefined
      ? (patch ?? argumentsText)
      : (toolCall.result.details ?? toolCall.result.content ?? patch);
  const fallbackTitle = toolCall.result === undefined ? (patch ? "Patch" : "Arguments") : "Result";
  const expansionState = toolCall.result?.success === false ? "failed" : "default";

  const headerExtra = lineDiff && (
    <span className="text-xs shrink-0">
      <span className="text-diff-added">+{lineDiff.added}</span>{" "}
      <span className="text-diff-removed">-{lineDiff.removed}</span>
    </span>
  );

  return (
    <ToolCallCard
      key={expansionState}
      {...props}
      toolCall={toolCall}
      icon={Pencil}
      label={getFileDiffToolCallLabel(toolCall.name, fileDiffs, cwd)}
      defaultExpanded={expansionState !== "failed"}
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
