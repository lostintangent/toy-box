import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { CommandButton } from "@/shared/commands/CommandButton";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { sessionAttention } from "@sessions/model/activity";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { automationQueries } from "../queries";
import { AutomationListItem } from "./AutomationListItem";

type AutomationPanelProps = {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  openSessionIds: string[];
  onSessionOpen: (sessionId: string) => void;
};

export function AutomationPanel({
  isExpanded,
  onExpandedChange,
  openSessionIds,
  onSessionOpen,
}: AutomationPanelProps) {
  const disabledProviders = useWorkspaceSelector(
    (workspace) => workspace.settings.disabledProviders,
  );
  const { data: automations } = useSuspenseQuery({
    ...automationQueries.list(),
    select: (list) =>
      list.filter((automation) => !disabledProviders.includes(automation.model.provider)),
  });
  const activity = useSessionsActivity((activities) => {
    const attention = automations.map(({ id }) =>
      sessionAttention(activities[id]?.status, openSessionIds.includes(id)),
    );
    return {
      waiting: attention.includes("waiting"),
      unread: attention.includes("unread"),
      running: automations.some(({ id }) => activities[id]?.status === "running"),
    };
  });
  if (automations.length === 0) return null;

  return (
    <SidebarPanel
      title="Automations"
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      activity={activity}
      action={
        <CommandButton command="automation.create" size="icon" variant="ghost" className="h-6 w-6">
          <Plus className="h-4 w-4" />
        </CommandButton>
      }
    >
      {automations.map((automation) => {
        const isSelected = openSessionIds.includes(automation.id);
        return (
          <AutomationListItem
            key={automation.id}
            automation={automation}
            isSelected={isSelected}
            onOpenSession={onSessionOpen}
          />
        );
      })}
    </SidebarPanel>
  );
}
