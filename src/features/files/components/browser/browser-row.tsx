import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/utils";

export function BrowserRow({
  depth,
  icon: Icon,
  label,
  onActivate,
  onToggle,
  expanded,
  selected,
  muted,
  spin,
  children,
}: {
  depth: number;
  icon: LucideIcon;
  label: string;
  onActivate?: () => void;
  onToggle?: () => void;
  expanded?: boolean;
  selected?: boolean;
  muted?: boolean;
  spin?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      style={{ paddingLeft: depth * 14 + 8 }}
      className={cn(
        "group flex items-center gap-1 rounded-sm pr-2 text-sm",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 hover:text-accent-foreground",
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          className="shrink-0 rounded p-0.5"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              muted && "text-muted-foreground",
              expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={onActivate}
        disabled={!onActivate}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left",
          !onActivate && "pointer-events-none",
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            muted && "text-muted-foreground",
            spin && "animate-spin",
          )}
        />
        <span className={cn("truncate", muted && "text-muted-foreground")}>{label}</span>
      </button>
      {children}
    </div>
  );
}
