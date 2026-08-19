import { useState, type ReactNode } from "react";
import { ChevronRight, Loader2, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ToolCall } from "../../../../model";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { cn } from "@/shared/utils";

type ToolCallCardProps = {
  toolCall: ToolCall;
  icon?: LucideIcon;
  label: ReactNode;
  isActive?: boolean;
  defaultExpanded?: boolean;
  headerExtra?: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
};

export function ToolCallCard({
  toolCall,
  icon: Icon,
  label,
  isActive = false,
  defaultExpanded = false,
  headerExtra,
  children,
  bodyClassName,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasResult = toolCall.result !== undefined;
  const isSuccess = toolCall.result?.success === true;
  const BaseIcon = Icon ?? Wrench;

  // Type icon always visible on the left
  const typeIcon = <BaseIcon className="h-3 w-3 shrink-0 text-muted-foreground" />;

  // Status icon shown on the right (spinner while active, X on failure)
  const statusIcon = isActive ? (
    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
  ) : hasResult && !isSuccess ? (
    <X className="h-3 w-3 shrink-0 text-destructive" />
  ) : null;

  return (
    <div className="w-fit min-w-0 max-w-full text-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-3 py-1 text-left transition-colors hover:bg-muted/50"
      >
        {/* Type icon */}
        {typeIcon}

        {/* Label */}
        <ScrollableFade
          asChild
          className="min-w-0 flex-1 whitespace-nowrap text-xs text-muted-foreground"
        >
          <span>{label}</span>
        </ScrollableFade>

        {/* Status icon (spinner while active, X on failure) */}
        {statusIcon}

        {/* Header extra (e.g., line diff stats, tool count badge) */}
        {headerExtra}

        {/* Expand/collapse chevron: points right when collapsed, rotates down when expanded.
            Hidden while running so it doesn't sit next to the status spinner. */}
        {!isActive && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </button>

      {/* Expanded content: a left rule under the icon connects the detail to its header */}
      {isExpanded && children && (
        <div className="ml-4 border-l border-border/50 pl-4">
          <div className={cn("pt-2 pb-2 space-y-2", bodyClassName)}>{children}</div>
        </div>
      )}
    </div>
  );
}
