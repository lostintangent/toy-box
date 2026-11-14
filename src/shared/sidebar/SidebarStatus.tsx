import type { ReactNode } from "react";
import { Circle, Layers, Pencil } from "lucide-react";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";

/** What a sidebar row or collapsed panel is signaling in place of its action. */
export type SidebarStatus = {
  kind: "waiting" | "running" | "background" | "finished" | "unread" | "draft";
  ariaLabel: string;
  /** Shown on hover, unless the surface explains the status itself, as a Channel's request
   *  preview does. */
  tooltip?: string;
};

export function SidebarStatus({
  status,
  className,
}: {
  status: SidebarStatus;
  className?: string;
}) {
  const mark = (
    <div
      role="status"
      className={cn("flex shrink-0 items-center justify-center", className)}
      aria-label={status.ariaLabel}
    >
      <SidebarStatusMark kind={status.kind} />
    </div>
  );
  if (!status.tooltip) return mark;
  return (
    <Tooltip>
      <TooltipTrigger render={mark} />
      <TooltipContent sideOffset={6}>{status.tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** A status's mark alone, for surfaces that label it themselves. */
export function SidebarStatusMark({ kind }: { kind: SidebarStatus["kind"] }) {
  return MARKS[kind];
}

const MARKS: Record<SidebarStatus["kind"], ReactNode> = {
  waiting: <RunningIndicator waiting className="size-4.5 text-muted-foreground" />,
  running: <RunningIndicator className="size-4.5 text-muted-foreground" />,
  background: <Layers className="size-4 text-muted-foreground" aria-hidden />,
  finished: <DoneIndicator className="size-5.5 animate-in zoom-in-50 motion-reduce:animate-none" />,
  unread: <Circle className="size-2.5 fill-unread text-unread" aria-hidden />,
  draft: <Pencil className="size-4 text-muted-foreground/70" aria-hidden />,
};
