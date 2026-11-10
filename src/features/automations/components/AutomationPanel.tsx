import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { CommandButton } from "@/shared/commands/CommandButton";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { sessionAttention } from "@sessions/model/activity";
import { createSessionPane } from "@sessions/model/panes";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { useWorkspaceRoots } from "@workspace/hooks/layout/roots";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { automationQueries } from "../queries";
import { AutomationListItem } from "./AutomationListItem";

type AutomationPanelProps = {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export function AutomationPanel({ isExpanded, onExpandedChange }: AutomationPanelProps) {
  const { selectRoot, isOpen } = useWorkspaceRoots();
  const disabledProviders = useWorkspaceSelector(
    (workspace) => workspace.settings.disabledProviders,
  );
  const { data: automations } = useSuspenseQuery({
    ...automationQueries.list,
    select: (list) =>
      list.filter((automation) => !disabledProviders.includes(automation.model.provider)),
  });
  const activity = useSessionsActivity((activities) => {
    const attention = automations.map(({ id }) =>
      sessionAttention(activities[id]?.status, isOpen(createSessionPane(id))),
    );
    return {
      waiting: attention.includes("waiting"),
      unread: attention.includes("unread"),
      running: automations.some(({ id }) => activities[id]?.status === "running"),
    };
  });

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
      emptyMessage="Automations run sessions on a schedule."
    >
      {automations.map((automation) => {
        const isSelected = isOpen(createSessionPane(automation.id));
        return (
          <AutomationListItem
            key={automation.id}
            automation={automation}
            isSelected={isSelected}
            onOpenSession={(sessionId) => selectRoot(createSessionPane(sessionId))}
          />
        );
      })}
    </SidebarPanel>
  );
}
