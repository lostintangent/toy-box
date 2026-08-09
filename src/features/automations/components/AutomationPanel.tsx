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
};

type AutomationDialogState = { mode: "create" } | { mode: "edit"; automationId: string };

export function AutomationPanel({
  isExpanded,
  onExpandedChange,
  openSessionIds,
  onSessionOpen,
}: AutomationPanelProps) {
  const { data: automations } = useSuspenseQuery(automationQueries.list());
  const [dialogState, setDialogState] = useState<AutomationDialogState | null>(null);

  function closeDialog() {
    setDialogState(null);
  }

  function openCreateDialog() {
    setDialogState({ mode: "create" });
  }

  function openEditDialog(automationId: string) {
    setDialogState({ mode: "edit", automationId });
  }

  function handleExpandedChange(expanded: boolean) {
    if (!expanded) closeDialog();
    onExpandedChange(expanded);
  }

  const dialogAutomationId = dialogState?.mode === "edit" ? dialogState.automationId : null;
  const dialogTargetAutomation =
    automations.find((automation) => automation.id === dialogAutomationId) ?? null;

  return (
    <>
      <SidebarPanel
        title="Automations"
        count={automations.length}
        isExpanded={isExpanded}
        onExpandedChange={handleExpandedChange}
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Add automation"
                onClick={openCreateDialog}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent sideOffset={6}>Add automation</TooltipContent>
          </Tooltip>
        }
        emptyMessage="No automations yet."
      >
        {automations.map((automation) => {
          const isSelected = openSessionIds.includes(automation.id);
          return (
            <AutomationListItem
              key={automation.id}
              automation={automation}
              isSelected={isSelected}
              onOpenSession={onSessionOpen}
              onEdit={() => openEditDialog(automation.id)}
            />
          );
        })}
      </SidebarPanel>

      {dialogState?.mode === "create" ? (
        <AutomationDialog
          mode="create"
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        />
      ) : dialogTargetAutomation ? (
        <AutomationDialog
          key={dialogTargetAutomation.id}
          mode="edit"
          automation={dialogTargetAutomation}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        />
      ) : null}
    </>
  );
}
