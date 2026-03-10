import { Circle, Clock3, Loader2, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { MetadataBadge } from "@/components/ui/metadata-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarListItemMainButton,
  SidebarListItemShell,
} from "@/components/sidebar/list/SidebarListItemShell";
import { useSidebarScrollFade } from "@/components/sidebar/list/useSidebarScrollFade";
import { cn } from "@/lib/utils";
import type { Automation } from "@/types";

type AutomationListItemProps = {
  automation: Automation;
  isSelected: boolean;
  isRunning: boolean;
  isUnread: boolean;
  isDeleting: boolean;
  isUpdating: boolean;
  onOpenSession: (sessionId: string) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function AutomationListItem({
  automation,
  isSelected,
  isRunning,
  isUnread,
  isDeleting,
  isUpdating,
  onOpenSession,
  onRun,
  onEdit,
  onDelete,
}: AutomationListItemProps) {
  const { headlineRef, updateScrollFades } = useSidebarScrollFade(automation.title);
  const canOpenSession = Boolean(automation.lastRunSessionId);

  return (
    <SidebarListItemShell
      isActive={isSelected}
      action={
        isRunning ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={`${automation.title} is running`}
            disabled
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </Button>
        ) : isUnread ? (
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center"
            aria-label={`${automation.title} has unread activity`}
          >
            <Circle className="h-2.5 w-2.5 fill-blue-500 text-blue-500" />
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={`Actions for ${automation.title}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRun}>
                <Play className="h-3.5 w-3.5" />
                Run automation
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isUpdating} onSelect={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit automation
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={isDeleting}
                onSelect={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete automation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <SidebarListItemMainButton
        onClick={() => {
          if (!automation.lastRunSessionId) return;
          onOpenSession(automation.lastRunSessionId);
        }}
        aria-current={isSelected ? "page" : undefined}
        aria-disabled={!canOpenSession}
        headline={automation.title}
        headlineRef={headlineRef}
        onHeadlineScroll={updateScrollFades}
        onHeadlinePointerEnter={updateScrollFades}
        headlineClassName="text-sm font-medium"
        className={cn(!canOpenSession && "cursor-default")}
        secondary={
          <>
            <div className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground/70">
              {automation.lastRunAt ? <RelativeTime date={automation.lastRunAt} /> : "Never run"}
            </div>
            <MetadataBadge>
              <Clock3 className="h-3 w-3 shrink-0" />
              <RelativeTime date={automation.nextRunAt} />
            </MetadataBadge>
          </>
        }
      />
    </SidebarListItemShell>
  );
}
