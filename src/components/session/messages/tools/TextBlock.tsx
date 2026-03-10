import type { ReactNode } from "react";

export interface TextBlockProps {
  /** Optional title shown above the content */
  title?: string;
  /** Max height class (default: "max-h-48") */
  maxHeight?: string;
  /** Content to display - if falsy, renders nothing */
  children?: ReactNode;
}

export function TextBlock({ title, maxHeight = "max-h-48", children }: TextBlockProps) {
  if (!children) return null;

  return (
    <div>
      {title && <div className="text-xs text-muted-foreground mb-1">{title}</div>}
      <pre
        className={`text-xs bg-muted/50 p-2 rounded overflow-x-auto ${maxHeight} whitespace-pre-wrap break-words font-mono`}
      >
        {children}
      </pre>
    </div>
  );
}
