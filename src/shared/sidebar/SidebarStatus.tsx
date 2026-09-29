import type { ReactNode } from "react";
import { Circle, Pencil } from "lucide-react";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { WaitingIndicator } from "@/shared/ui/waiting-indicator";
import { cn } from "@/shared/utils";

/** What a sidebar row or collapsed panel is signaling in place of its action. */
export type SidebarStatus = {
  kind: "waiting" | "running" | "finished" | "unread" | "draft";
  ariaLabel: string;
  tooltip: string;
};

export function SidebarStatus({
  status,
  className,
}: {
  status: SidebarStatus;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="status"
            className={cn("flex shrink-0 items-center justify-center", className)}
            aria-label={status.ariaLabel}
          >
            {MARKS[status.kind]}
          </div>
        }
      />
      <TooltipContent sideOffset={6}>{status.tooltip}</TooltipContent>
    </Tooltip>
  );
}

const MARKS: Record<SidebarStatus["kind"], ReactNode> = {
  waiting: <WaitingIndicator className="size-5.5" />,
  running: <RunningIndicator className="size-4.5 text-muted-foreground" />,
  finished: <DoneIndicator className="size-5.5 animate-in zoom-in-50 motion-reduce:animate-none" />,
  unread: <Circle className="size-2.5 fill-unread text-unread" aria-hidden />,
  draft: <Pencil className="size-4 text-muted-foreground/70" aria-hidden />,
};
