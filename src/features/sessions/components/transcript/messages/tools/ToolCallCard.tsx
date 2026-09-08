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
  const isExpandable = children !== undefined && children !== null;
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

  const headerContent = (
    <>
      {typeIcon}
      <ScrollableFade className="min-w-0 flex-1 whitespace-nowrap text-xs text-muted-foreground">
        <span>{label}</span>
      </ScrollableFade>
      {statusIcon}
      {headerExtra}
      {!isActive && isExpandable && (
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-90",
          )}
        />
      )}
    </>
  );

  return (
    <div className="w-fit min-w-0 max-w-full text-sm">
      {isExpandable ? (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-3 py-1 text-left transition-colors hover:bg-muted/50"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-3 py-1 transition-colors hover:bg-muted/50">
          {headerContent}
        </div>
      )}

      {/* Expanded content: a left rule under the icon connects the detail to its header */}
      {isExpandable && isExpanded && (
        <div className="ml-4 border-l border-border/50 pl-4">
          <div className={cn("pt-2 pb-2 space-y-2", bodyClassName)}>{children}</div>
        </div>
      )}
    </div>
  );
}
