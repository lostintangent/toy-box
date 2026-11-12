import { useEffect, useState, type CSSProperties } from "react";
import type { HighlightToken } from "streamdown";
import { HighlightedTokens, highlightCode } from "@/shared/syntaxHighlight";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { fileExtension } from "../../../../model/paths";
import type { EditorProps } from "../index";

/** Renders any other text file read-only as numbered lines, highlighted like transcript code. */
export function CodeViewer({ file }: EditorProps) {
  const text = file.content ?? "";
  const language = fileExtension(file.source.path);

  // Like GitHub, the final newline ends the last line rather than starting an empty one.
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const [highlighted, setHighlighted] = useState<HighlightToken[][]>();

  useEffect(() => {
    let current = true;
    void highlightCode(text, language).then((tokens) => current && setHighlighted(tokens));
    return () => {
      current = false;
    };
  }, [text, language]);

  return (
    // Long lines scroll sideways in the same viewport that fades vertically, and each line
    // pads itself so the longest keeps its margin at the end of that scroll.
    <ScrollableFade axis="vertical" rootClassName="h-full" style={{ overflowX: "auto" }}>
      <pre
        className="py-4 text-sm"
        style={{ "--gutter": `${String(lines.length).length}ch` } as CSSProperties}
      >
        {lines.map((line, index) => {
          // Until a change is re-highlighted, lines it moved or edited show as plain text.
          const tokens = highlighted?.[index];
          return (
            <div
              // eslint-disable-next-line react/no-array-index-key -- lines are positions in one file
              key={index}
              data-line={index + 1}
              className="w-max min-w-full px-4 [contain-intrinsic-size:auto_1lh] [content-visibility:auto] before:mr-4 before:inline-block before:w-(--gutter) before:text-right before:text-muted-foreground/50 before:content-[attr(data-line)]"
            >
              {tokens?.map((token) => token.content).join("") === line ? (
                <HighlightedTokens tokens={tokens} />
              ) : (
                line
              )}
            </div>
          );
        })}
      </pre>
    </ScrollableFade>
  );
}
