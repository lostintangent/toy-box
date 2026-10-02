import { startTransition, useEffect, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { highlightCode, type HighlightedLine } from "@/shared/syntaxHighlight";
import { cn } from "@/shared/utils";

type HighlightedSource = {
  key: string;
  lines: HighlightedLine[] | null;
};

/** Render authored pseudocode without implying production implementation. */
export function PseudocodeBlock({
  content,
  language,
  label,
  compact = false,
}: {
  content: string;
  language?: string;
  label: string;
  compact?: boolean;
}) {
  const sourceKey = `${language ?? "text"}\u0000${content}`;
  const [highlighted, setHighlighted] = useState<HighlightedSource>();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const lines = highlighted?.key === sourceKey ? highlighted.lines : undefined;

  useEffect(() => {
    let cancelled = false;
    void highlightCode(content, language ?? "text")
      .then((nextLines) => {
        if (cancelled) return;
        startTransition(() => setHighlighted({ key: sourceKey, lines: nextLines }));
      })
      .catch(() => {
        if (cancelled) return;
        startTransition(() => setHighlighted({ key: sourceKey, lines: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [content, language, sourceKey]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function copyCode() {
    if (!navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const CopyIcon = copyState === "copied" ? Check : copyState === "failed" ? TriangleAlert : Copy;
  const copyLabel =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy";

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-muted/30 text-foreground">
      <div className="flex h-8 items-center justify-between gap-2 border-b border-border/70 px-2.5">
        <span className="truncate font-mono text-[9.5px] text-muted-foreground">
          {language ?? "text"}
        </span>
        <button
          type="button"
          onClick={() => void copyCode()}
          aria-label={`${copyLabel} ${label}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded px-1.5 text-[9.5px] text-muted-foreground hover:bg-muted hover:text-foreground",
            copyState === "copied" && "text-emerald-400",
            copyState === "failed" && "text-rose-400",
          )}
        >
          <CopyIcon className="size-3" />
          {copyLabel}
        </button>
      </div>
      <pre
        data-language={language ?? "text"}
        className={cn(
          "max-w-full overflow-x-auto p-3 font-mono leading-relaxed",
          compact ? "max-h-52 text-[10px]" : "max-h-80 text-[10.5px]",
        )}
      >
        <code>{lines ? <HighlightedLines lines={lines} /> : content}</code>
      </pre>
    </div>
  );
}

function HighlightedLines({ lines }: { lines: HighlightedLine[] }) {
  return lines.map((line, lineIndex) => (
    <span
      // eslint-disable-next-line react/no-array-index-key -- highlighted rows preserve exact source order
      key={lineIndex}
    >
      {line.tokens.map((token, tokenIndex) => (
        <span
          // eslint-disable-next-line react/no-array-index-key -- Shiki tokens have no stable identity
          key={tokenIndex}
          style={{ color: token.color }}
        >
          {token.content}
        </span>
      ))}
      {lineIndex < lines.length - 1 ? "\n" : null}
    </span>
  ));
}
