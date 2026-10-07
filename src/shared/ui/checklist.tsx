import { useState, type ReactNode } from "react";
import { ChevronRight, CircleSlash } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { cn } from "@/shared/utils";

export type ChecklistStatus = "pending" | "in_progress" | "blocked" | "done";

export type ChecklistItem = {
  id: string;
  title: string;
  status: ChecklistStatus;
  /** Supporting context beside the title's first line, such as ownership or outcomes. */
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
  const completedCount = children.filter(({ status }) => status === "done").length;
  const lastSpace = item.title.lastIndexOf(" ");
  const titleClassName = cn("wrap-anywhere", item.status === "done" && "text-muted-foreground");

  return (
    <li className="space-y-2">
      <div
        role="presentation"
        className={cn(
          "group/checklist-row flex min-w-0 items-start gap-2 leading-snug",
          children.length > 0 && "cursor-pointer",
        )}
        onClick={(event) => {
          if (
            children.length > 0 &&
            event.target instanceof Element &&
            !event.target.closest("button, a, input, select, textarea, [role=button], [role=link]")
          ) {
            setExpanded((current) => !current);
          }
        }}
      >
        <span className="flex h-lh w-4 shrink-0 items-center justify-center *:shrink-0">
          {MARKS[item.status]}
        </span>
        <div className="flow-root min-w-0 flex-1">
          {item.detail && (
            <span className="float-right ms-2.5 flex h-lh items-center">{item.detail}</span>
          )}
          {children.length > 0 ? (
            <span className={titleClassName}>
              {item.title.slice(0, lastSpace + 1)}
              <span className="whitespace-nowrap">
                {item.title.slice(lastSpace + 1)}
                {item.status !== "done" && (
                  <Badge
                    variant="count"
                    className="ms-1.5 align-middle"
                    aria-label={`${completedCount} of ${children.length} subtasks complete`}
                  >
                    {completedCount}/{children.length}
                  </Badge>
                )}
                <button
                  type="button"
                  className="ms-0.5 inline-flex size-[1.15em] items-center justify-center rounded-sm align-[-0.2em] text-muted-foreground outline-none group-hover/checklist-row:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Subtasks of ${item.title}`}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((current) => !current)}
                >
                  <ChevronRight
                    aria-hidden
                    className={cn("size-3 transition-transform", expanded && "rotate-90")}
                  />
                </button>
              </span>
            </span>
          ) : (
            <span className={titleClassName}>{item.title}</span>
          )}
        </div>
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
