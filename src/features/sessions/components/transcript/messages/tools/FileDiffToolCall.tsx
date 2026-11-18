import { startTransition, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import type { HighlightToken } from "streamdown";
import { HighlightedTokens, highlightCode } from "@/shared/syntaxHighlight";
import type { ToolCallProps } from "./types";
import { useCurrentSession } from "../../../CurrentSessionContext";
import {
  computeFileDiffStats,
  getToolCallFileDiffs,
  type DiffHunk,
  type FileDiff,
} from "../../../../model/fileDiffs";
import { fileExtension, toRelativePath } from "@files/model/paths";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

type DiffLine = DiffHunk[number] & { tokens?: HighlightToken[] };

interface DiffRenderSource {
  hunk: DiffHunk;
  lines: DiffLine[];
  minIndent: number;
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
    if (line.text.trim()) {
      const match = line.text.match(/^[ \t]*/);
      const indent = match ? match[0].length : 0;
      if (indent === 0) return 0;
      minIndent = Math.min(minIndent, indent);
    }
  }

  return minIndent === Infinity ? 0 : minIndent;
}

function stripCommonIndent(diffLines: DiffLine[], indent: number): DiffLine[] {
  if (indent === 0) return diffLines;

  return diffLines.map((line) => ({ ...line, text: line.text.slice(indent) }));
}

function createDiffRenderSource(hunk: DiffHunk, path: string): DiffRenderSource {
  const minIndent = computeMinIndent(hunk);
  return { hunk, lines: stripCommonIndent(hunk, minIndent), minIndent, path };
}

function renderTokens(tokens: HighlightToken[] | undefined, fallback: string) {
  if (!tokens) return fallback || "\u00A0";
  if (tokens.length === 0) return "\u00A0";

  return <HighlightedTokens tokens={tokens} />;
}

function stripTokensIndent(
  tokens: HighlightToken[] | undefined,
  indent: number,
): HighlightToken[] | undefined {
  if (!tokens || indent === 0) return tokens;

  const result: HighlightToken[] = [];
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
  return <div className={DIFF_LINE_CLASSES[line.type]}>{renderTokens(line.tokens, line.text)}</div>;
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

/** Highlights each side of the hunk whole, so a line's tokens see the lines around it. */
async function highlightDiffLines({
  hunk,
  lines,
  minIndent,
  path,
}: DiffRenderSource): Promise<DiffLine[]> {
  const language = fileExtension(path);
  const sideText = (omitted: DiffLine["type"]) =>
    hunk
      .filter((line) => line.type !== omitted)
      .map((line) => line.text)
      .join("\n");
  const [oldHighlighted, newHighlighted] = await Promise.all([
    highlightCode(sideText("added"), language),
    highlightCode(sideText("removed"), language),
  ]);
  let oldLineIndex = 0;
  let newLineIndex = 0;

  return lines.map((line): DiffLine => {
    const oldTokens = stripTokensIndent(oldHighlighted[oldLineIndex], minIndent);
    const newTokens = stripTokensIndent(newHighlighted[newLineIndex], minIndent);

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
    void highlightDiffLines(source).then((enhanced) => {
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
  return hunk.map((line) => `${line.type[0]}${encodeKeyPart(line.text)}`).join("");
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
  const lineDiff = fileDiffs && computeFileDiffStats(fileDiffs).total;
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
