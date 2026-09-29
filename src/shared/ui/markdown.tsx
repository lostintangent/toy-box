import type { ReactNode } from "react";
import { Lexer, type Token } from "marked";
import { parseEntities } from "parse-entities";
import { defaultRemarkPlugins, Streamdown, type StreamdownProps } from "streamdown";
import { cn } from "@/shared/utils";

type MarkdownProps = StreamdownProps & {
  /** Preserve authored newlines inside text blocks, not whitespace between Markdown blocks. */
  preserveLineBreaks?: boolean;
};

type InlineMarkdownProps = {
  children: string;
  allowLinks?: boolean;
};

export function Markdown({
  className,
  mode = "static",
  preserveLineBreaks = false,
  remarkPlugins,
  ...streamdownProps
}: MarkdownProps) {
  return (
    <Streamdown
      {...streamdownProps}
      mode={mode}
      remarkPlugins={
        preserveLineBreaks
          ? [...(remarkPlugins ?? Object.values(defaultRemarkPlugins)), remarkPreserveLineBreaks]
          : remarkPlugins
      }
      className={cn("space-y-3 [&_blockquote]:space-y-2", className)}
    />
  );
}

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };

function remarkPreserveLineBreaks() {
  return (root: MarkdownNode) => {
    const visit = (node: MarkdownNode): void => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value?.includes("\n")) {
          visit(child);
          return child;
        }
        return child.value
          .split("\n")
          .flatMap((value, index) => [
            ...(index ? [{ type: "break" }] : []),
            ...(value ? [{ type: "text", value }] : []),
          ]);
      });
    };
    visit(root);
  };
}

export function InlineMarkdown({ children, allowLinks = true }: InlineMarkdownProps) {
  return <>{renderInline(Lexer.lexInline(children), allowLinks)}</>;
}

function renderInline(tokens: Token[], allowLinks: boolean): ReactNode[] {
  let offset = 0;
  return tokens.map((token) => {
    const key = offset;
    offset += token.raw.length;
    switch (token.type) {
      case "text":
      case "escape":
      case "html":
      case "image":
        return parseEntities(token.text);
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(token.tokens ?? [], allowLinks)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(token.tokens ?? [], allowLinks)}</em>;
      case "del":
        return <del key={key}>{renderInline(token.tokens ?? [], allowLinks)}</del>;
      case "codespan":
        return (
          <code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[1em]">
            {token.text}
          </code>
        );
      case "br":
        return <br key={key} />;
      case "link": {
        const label = renderInline(token.tokens ?? [], allowLinks);
        const href = safeHref(token.href);
        return allowLinks && href !== undefined ? (
          <a
            key={key}
            href={href}
            title={token.title ? parseEntities(token.title) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="wrap-anywhere font-medium text-primary underline"
          >
            {label}
          </a>
        ) : (
          label
        );
      }
      default:
        return parseEntities(token.raw);
    }
  });
}

function safeHref(raw: string): string | undefined {
  const href = parseEntities(raw);
  try {
    const protocol = new URL(href, "https://localhost").protocol;
    if (["http:", "https:", "mailto:", "tel:"].includes(protocol)) return href;
  } catch {
    return undefined;
  }
}
