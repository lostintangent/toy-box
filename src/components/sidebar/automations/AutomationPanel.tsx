import { useState } from "react";
import { Plus } from "lucide-react";
import { AutomationDialog } from "./AutomationDialog";
import { Button } from "@/components/ui/button";
import { DestructiveConfirmationDialog } from "@/components/sidebar/shell/dialogs/DestructiveConfirmationDialog";
import { SidebarPanel } from "@/components/sidebar/shell/panels/SidebarPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAutomationActions } from "@/hooks/automations/useAutomationActions";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
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
  const automations = useWorkspaceSelector((workspace) => workspace.automations);
  const {
    createAutomation,
    updateAutomation,
    deleteAutomation,
    runAutomation,
    isCreatingAutomation,
    updatingAutomationId,
    deletingAutomationId,
  } = useAutomationActions();
  const [dialogState, setDialogState] = useState<AutomationDialogState | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  function closeDialog() {
    setDialogState(null);
  }

  function openCreateDialog() {
    setDialogState({ mode: "create" });
  }

  function openEditDialog(automationId: string) {
    setDialogState({ mode: "edit", automationId });
  }

  async function handleRunAutomation(automationId: string) {
    try {
      onSessionOpen(await runAutomation(automationId));
    } catch (error) {
      console.error("Failed to run automation:", error);
    }
  }

  async function handleDeleteAutomation(automationId: string) {
    try {
      await deleteAutomation(automationId);
    } catch (error) {
      console.error("Failed to delete automation:", error);
    }
  }

  function handleExpandedChange(expanded: boolean) {
    if (!expanded) closeDialog();
    onExpandedChange(expanded);
  }

  const isEditing = dialogState?.mode === "edit";
  const dialogAutomationId = dialogState?.mode === "edit" ? dialogState.automationId : null;
  const dialogTargetAutomation =
    automations.find((automation) => automation.id === dialogAutomationId) ?? null;
  const isDialogOpen = dialogState?.mode === "create" || dialogTargetAutomation !== null;
  const isDialogSubmitting = isEditing
    ? updatingAutomationId === dialogAutomationId
    : isCreatingAutomation;
  const deleteTargetAutomation =
    automations.find((automation) => automation.id === deleteTargetId) ?? null;

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
      >
        {automations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No automations yet.</p>
        ) : (
          <ul className="space-y-2">
            {automations.map((automation) => {
              const isSelected = openSessionIds.includes(automation.id);
              return (
                <li key={automation.id}>
                  <AutomationListItem
                    automation={automation}
                    isSelected={isSelected}
                    isDeleting={deletingAutomationId === automation.id}
                    isUpdating={updatingAutomationId === automation.id}
                    onOpenSession={onSessionOpen}
                    onRun={() => {
                      void handleRunAutomation(automation.id);
                    }}
                    onEdit={() => {
                      openEditDialog(automation.id);
                    }}
                    onDelete={() => {
                      setDeleteTargetId(automation.id);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </SidebarPanel>

      <AutomationDialog
        open={isDialogOpen}
        mode={dialogState?.mode ?? "create"}
        automation={dialogTargetAutomation}
        isSubmitting={isDialogSubmitting}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        onCreateAutomation={createAutomation}
        onUpdateAutomation={updateAutomation}
      />

      <DestructiveConfirmationDialog
        open={deleteTargetAutomation !== null}
        title="Delete automation?"
        description={`This removes ${
          deleteTargetAutomation?.title ?? "the automation"
        }, its schedule, and its session.`}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetId(null);
          }
        }}
        onConfirm={() => {
          if (!deleteTargetAutomation) return;
          void handleDeleteAutomation(deleteTargetAutomation.id);
          setDeleteTargetId(null);
        }}
      />
    </>
  );
}
