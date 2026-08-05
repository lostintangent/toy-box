import type { ReactNode } from "react";
import { ScrollableFade } from "@/components/ui/scrollable-fade";
import { cn } from "@/lib/utils";

export function SidebarPanel({
  title,
  count,
  isExpanded,
  onExpandedChange,
  action,
  children,
}: {
  title: string;
  count: number;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  action?: ReactNode;
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
            <ScrollableFade axis="vertical" className="max-h-56 min-w-0 bg-muted/50 px-3 py-2">
              {children}
            </ScrollableFade>
          </div>
        </div>
      </div>
    </section>
  );
}
