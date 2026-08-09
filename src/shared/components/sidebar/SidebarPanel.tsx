import type { ReactNode } from "react";
import { SidebarList } from "./SidebarList";
import { cn } from "@/shared/utils";

export function SidebarPanel({
  title,
  count,
  isExpanded,
  onExpandedChange,
  action,
  emptyMessage,
  children,
}: {
  title: string;
  count: number;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  action?: ReactNode;
  emptyMessage: string;
  children: ReactNode;
}) {
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
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="section-heading">
            {title}
            {count > 0 ? ` (${count})` : ""}
          </span>
        </button>

        {isExpanded && action}
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
              className="max-h-56 bg-muted/50 px-3 py-2"
              emptyState={<p className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</p>}
            >
              {children}
            </SidebarList>
          </div>
        </div>
      </div>
    </section>
  );
}
