import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Clock3, Pencil, Play, Trash2 } from "lucide-react";
import { MetadataBadge } from "@/shared/components/ui/metadata-badge";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/shared/components/ui/dropdown-menu";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { SidebarSessionItem } from "@sessions/components/sidebar/SidebarSessionItem";
import { useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { automationMutations } from "../mutations";
import type { Automation } from "../model";

type AutomationListItemProps = {
  automation: Automation;
  isSelected: boolean;
  onOpenSession: (sessionId: string) => void;
  onEdit: () => void;
};

export function AutomationListItem({
  automation,
  isSelected,
  onOpenSession,
  onEdit,
}: AutomationListItemProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const runMutation = useMutation(automationMutations.run(automation.id));
  const activity = useWorkspaceSessionActivity(automation.id);
  const { running: isRunning, unread: hasUnreadActivity } = activity;
  const canOpenSession = Boolean(automation.lastRunAt) || isRunning || hasUnreadActivity;

  function handleRun() {
    runMutation.mutate(undefined, {
      onSuccess: ({ sessionId }) => onOpenSession(sessionId),
    });
  }

  return (
    <>
      <SidebarSessionItem
        sessionId={automation.id}
        activity={activity}
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
        badge={
          <MetadataBadge>
            <Clock3 className="h-3 w-3 shrink-0" />
            <RelativeTime date={automation.nextRunAt} />
          </MetadataBadge>
        }
        menuItems={
          <>
            <DropdownMenuItem disabled={runMutation.isPending} onSelect={handleRun}>
              <Play className="h-3.5 w-3.5" />
              Run automation
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit automation
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete automation
            </DropdownMenuItem>
          </>
        }
        isActive={isSelected}
        onClick={() => onOpenSession(automation.id)}
        disabled={!canOpenSession}
        titleClassName="text-sm font-medium"
        buttonClassName={canOpenSession ? undefined : "cursor-default disabled:opacity-100"}
      />
      {deleteOpen && (
        <DestructiveConfirmationDialog
          title="Delete automation?"
          description={`This removes ${automation.title}, its schedule, and its session.`}
          mutation={automationMutations.delete(automation.id)}
          onOpenChange={(open) => {
            if (!open) setDeleteOpen(false);
          }}
        />
      )}
    </>
  );
}
