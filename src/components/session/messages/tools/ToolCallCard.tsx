import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Loader2, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ToolCall } from "@/types";
import { cn } from "@/lib/utils";

export interface ToolCallCardProps {
  /** Tool call data (used to derive success/failure status) */
  toolCall: ToolCall;
  /** Optional icon shown before completion (defaults to wrench) */
  icon?: LucideIcon;
  /** Label text shown in the header */
  label: ReactNode;
  /** Whether the tool is currently executing */
  isActive?: boolean;
  /** Whether to start expanded (default: false) */
  defaultExpanded?: boolean;
  /** Extra content in the header (e.g., line diff stats) */
  headerExtra?: ReactNode;
  /** Expandable content */
  children?: ReactNode;
  /** Custom class name for the body container */
  bodyClassName?: string;
}

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
    <X className="h-3 w-3 shrink-0 text-red-500" />
  ) : null;

  return (
    <div className="border rounded-md bg-muted/30 text-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        {/* Type icon */}
        {typeIcon}

        {/* Label */}
        <span className="truncate flex-1">{label}</span>

        {/* Status icon (spinner while active, X on failure) */}
        {statusIcon}

        {/* Header extra (e.g., line diff stats, tool count badge) */}
        {headerExtra}

        {/* Expand/collapse icon */}
        {isExpanded ? (
          <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && children && (
        <div className={cn("px-3 pt-2 pb-2 space-y-2 border-t border-border/50", bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
