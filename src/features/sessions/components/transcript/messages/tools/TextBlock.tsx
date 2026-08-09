import type { ReactNode } from "react";

type TextBlockProps = {
  title?: string;
  maxHeight?: string;
  children?: ReactNode;
};

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
