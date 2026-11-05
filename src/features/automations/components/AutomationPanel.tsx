import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { automationQueries } from "../queries";
import { AutomationListItem } from "./AutomationListItem";

type AutomationPanelProps = {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  openSessionIds: string[];
  onSessionOpen: (sessionId: string) => void;
  onCreate: () => void;
};

export function AutomationPanel({
  isExpanded,
  onExpandedChange,
  openSessionIds,
  onSessionOpen,
  onCreate,
}: AutomationPanelProps) {
  const { data: automations } = useSuspenseQuery(automationQueries.list());
  const activity = useSessionsActivity((activities) => ({
    waiting: automations.some(({ id }) => activities[id]?.status === "waiting"),
    unread: automations.some(
      ({ id }) => activities[id]?.status === "unread" && !openSessionIds.includes(id),
    ),
    running: automations.some(({ id }) => activities[id]?.status === "running"),
  }));
  if (automations.length === 0) return null;

  return (
    <SidebarPanel
      title="Automations"
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      activity={activity}
      action={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Create automation"
                onClick={onCreate}
              >
                <Plus className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent sideOffset={6}>Create automation</TooltipContent>
        </Tooltip>
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
