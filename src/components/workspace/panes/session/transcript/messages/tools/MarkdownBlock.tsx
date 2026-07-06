import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";

export interface MarkdownBlockProps {
  /** Optional title shown above the content */
  title?: string;
  /** Max height class (default: "max-h-48") */
  maxHeight?: string;
  /** Markdown content to display - if falsy, renders nothing */
  children?: string;
}

export function MarkdownBlock({ title, maxHeight = "max-h-48", children }: MarkdownBlockProps) {
  if (!children) return null;

  return (
    <div>
      {title && <div className="text-xs text-muted-foreground mb-1">{title}</div>}
      <div className={`text-xs bg-muted/50 p-2 rounded overflow-x-auto ${maxHeight}`}>
        <Streamdown plugins={{ code }} className="[&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1">
          {children}
        </Streamdown>
      </div>
    </div>
  );
}
