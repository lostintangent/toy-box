import { useMutation } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { RelativeTime } from "@/shared/ui/relative-time";
import { CommandMenuItems } from "@/shared/commands/CommandMenuItem";
import { SidebarSessionItem } from "@sessions/components/sidebar/SidebarSessionItem";
import { useSessionActivity } from "@sessions/useSessionActivity";
import { automationCommands } from "../commands";
import { automationMutations } from "../mutations";
import type { Automation } from "../model";

type AutomationListItemProps = {
  automation: Automation;
  isSelected: boolean;
  onOpenSession: (sessionId: string) => void;
};

export function AutomationListItem({
  automation,
  isSelected,
  onOpenSession,
}: AutomationListItemProps) {
  const runMutation = useMutation(automationMutations.run());
  const activity = useSessionActivity(automation.id);
  const isRunning = activity.running || runMutation.isPending;
  const hasUnreadActivity = activity.unread;
  const canOpenSession = Boolean(automation.lastRunAt) || isRunning || hasUnreadActivity;

  return (
    <SidebarSessionItem
      sessionId={automation.id}
      status={isRunning && !activity.waiting ? "running" : activity.status}
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
        <Badge variant="metadata">
          <Clock3 className="h-3 w-3 shrink-0" />
          <RelativeTime date={automation.nextRunAt} />
        </Badge>
      }
      menuItems={
        <CommandMenuItems
          commands={automationCommands(automation, { run: runMutation.mutate, isRunning })}
        />
      }
      isActive={isSelected}
      onClick={() => onOpenSession(automation.id)}
      disabled={!canOpenSession}
      titleClassName="font-medium"
      buttonClassName={canOpenSession ? undefined : "cursor-default disabled:opacity-100"}
    />
  );
}
