import { useState, type ReactNode } from "react";
import { ChevronRight, CircleSlash } from "lucide-react";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { cn } from "@/shared/utils";

export type ChecklistStatus = "pending" | "in_progress" | "blocked" | "done";

export type ChecklistItem = {
  id: string;
  title: string;
  status: ChecklistStatus;
  /** Supporting context in a trailing column beside the title's first line, such as who owns the
   *  item. Details line up across nested items. */
  detail?: ReactNode;
  children?: readonly ChecklistItem[];
};

/** Work items and their progress. Inherits its font size; done parents start collapsed. */
export function Checklist({
  items,
  className,
}: {
  items: readonly ChecklistItem[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item) => (
        // Keyed by status too, so a parent re-derives its expansion when it becomes done.
        <ChecklistRow key={`${item.id}:${item.status}`} item={item} />
      ))}
    </ul>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const children = item.children ?? [];
  const [expanded, setExpanded] = useState(item.status !== "done");
  const titleClassName = cn(item.status === "done" && "text-muted-foreground");

  return (
    <li className="space-y-2">
      <div className="flex min-w-0 items-start gap-2 leading-snug">
        <span className="flex h-lh w-4 shrink-0 items-center justify-center *:shrink-0">
          {MARKS[item.status]}
        </span>
        <div className="min-w-0 flex-1">
          {children.length > 0 ? (
            <button
              type="button"
              className="flex w-full min-w-0 items-start gap-1 text-left"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              <span className={cn("min-w-0 flex-1", titleClassName)}>{item.title}</span>
              <ChevronRight
                className={cn(
                  "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
            </button>
          ) : (
            <p className={titleClassName}>{item.title}</p>
          )}
        </div>
        {item.detail && (
          <span className="flex h-lh shrink-0 items-center gap-1 text-2xs text-muted-foreground">
            {item.detail}
          </span>
        )}
      </div>
      {expanded && children.length > 0 && (
        <Checklist items={children} className="ml-2 border-l pl-4" />
      )}
    </li>
  );
}

// Indicators draw at r=9, inside Lucide's stroked r=10 circle, so they're sized up to match its edge.
const MARKS: Record<ChecklistStatus, ReactNode> = {
  // The in-progress track without its arc, so starting work only adds the arc.
  pending: (
    <svg
      role="img"
      aria-label="Pending"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="size-4.5 text-muted-foreground"
    >
      <circle cx={12} cy={12} r={9} opacity={0.25} />
    </svg>
  ),
  in_progress: (
    <RunningIndicator
      role="img"
      aria-label="In progress"
      className="size-4.5 text-muted-foreground"
    />
  ),
  blocked: <CircleSlash role="img" aria-label="Blocked" className="size-4 text-destructive" />,
  done: <DoneIndicator role="img" aria-label="Done" className="size-5.5" />,
};
