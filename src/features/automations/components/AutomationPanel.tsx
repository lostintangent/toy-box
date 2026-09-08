import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AutomationDialog } from "./AutomationDialog";
import { Button } from "@/shared/components/ui/button";
import { SidebarPanel } from "@/shared/components/sidebar/SidebarPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
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
  const [editAutomationId, setEditAutomationId] = useState<string>();
  if (automations.length === 0) return null;

  function handleExpandedChange(expanded: boolean) {
    if (!expanded) setEditAutomationId(undefined);
    onExpandedChange(expanded);
  }

  const editing = automations.find((automation) => automation.id === editAutomationId);

  return (
    <>
      <SidebarPanel
        title="Automations"
        isExpanded={isExpanded}
        onExpandedChange={handleExpandedChange}
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
              onEdit={() => setEditAutomationId(automation.id)}
            />
          );
        })}
      </SidebarPanel>

      {editing && (
        <AutomationDialog
          key={editing.id}
          mode="edit"
          automation={editing}
          onOpenChange={(open) => {
            if (!open) setEditAutomationId(undefined);
          }}
        />
      )}
    </>
  );
}
