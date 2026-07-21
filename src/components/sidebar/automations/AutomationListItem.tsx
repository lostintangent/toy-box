import { Clock3, Pencil, Play, Trash2 } from "lucide-react";
import { MetadataBadge } from "@/components/ui/metadata-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SidebarListItem } from "@/components/sidebar/shell/SidebarListItem";
import type { Automation } from "@/types";
import { useWorkspaceSessionActivity } from "@/hooks/workspace/state";

type AutomationListItemProps = {
  automation: Automation;
  isSelected: boolean;
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
  isDeleting,
  isUpdating,
  onOpenSession,
  onRun,
  onEdit,
  onDelete,
}: AutomationListItemProps) {
  const { running: isRunning, unread: hasUnreadActivity } = useWorkspaceSessionActivity(
    automation.id,
  );
  const canOpenSession = Boolean(automation.lastRunAt) || isRunning || hasUnreadActivity;

  return (
    <SidebarListItem
      sessionId={automation.id}
      title={automation.title}
      time={
        isRunning ? (
          <span className="italic">Running</span>
        ) : automation.lastRunAt ? (
          <RelativeTime date={automation.lastRunAt} />
        ) : (
          <span className="italic">Never run</span>
        )
      }
      badges={
        <MetadataBadge>
          <Clock3 className="h-3 w-3 shrink-0" />
          <RelativeTime date={automation.nextRunAt} />
        </MetadataBadge>
      }
      menuItems={
        <>
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
        </>
      }
      menuDisabled={isDeleting}
      isActive={isSelected}
      onClick={() => onOpenSession(automation.id)}
      disabled={!canOpenSession}
      titleClassName="text-sm font-medium"
      buttonClassName={canOpenSession ? undefined : "cursor-default disabled:opacity-100"}
    />
  );
}
