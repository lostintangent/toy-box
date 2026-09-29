import { Children, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { SidebarList } from "./SidebarList";
import { SidebarStatus } from "./SidebarStatus";
import { cn } from "@/shared/utils";

export function SidebarPanel({
  title,
  isExpanded,
  onExpandedChange,
  action,
  activity,
  emptyMessage,
  children,
}: {
  title: string;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  action?: ReactNode;
  /** What its items are doing; while collapsed, the most pressing replaces the action. */
  activity?: { waiting?: boolean; finished?: boolean; unread?: boolean; running?: boolean };
  emptyMessage?: string;
  children: ReactNode;
}) {
  const count = Children.toArray(children).length;
  const status = isExpanded ? undefined : PANEL_STATUSES.find(({ kind }) => activity?.[kind]);

  return (
    <section className="min-w-0 overflow-hidden border-t">
      <div
        className={cn(
          "flex items-center gap-2 bg-background px-3 py-2",
          isExpanded && "border-b border-border",
        )}
      >
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${title.toLowerCase()}`}
          aria-expanded={isExpanded}
          onClick={() => onExpandedChange(!isExpanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
              isExpanded && "rotate-90",
            )}
          />
          <span className="section-heading">{title}</span>
          {count > 0 && <Badge variant="count">{count}</Badge>}
        </button>

        {status ? (
          <SidebarStatus
            status={{ ...status, ariaLabel: `${title}: ${status.tooltip.toLowerCase()}` }}
            className="size-6"
          />
        ) : (
          action
        )}
      </div>

      <div
        aria-hidden={!isExpanded}
        inert={!isExpanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              isExpanded ? "translate-y-0" : "-translate-y-1 pointer-events-none",
            )}
          >
            <SidebarList
              className="h-auto max-h-56 px-3 py-2"
              emptyState={
                emptyMessage && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</p>
                )
              }
            >
              {children}
            </SidebarList>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Most pressing first, with completion taking precedence over ordinary unread messages. */
const PANEL_STATUSES = [
  { kind: "waiting", tooltip: "Waiting for input" },
  { kind: "finished", tooltip: "Done" },
  { kind: "unread", tooltip: "Unread messages" },
  { kind: "running", tooltip: "Running" },
] as const;
