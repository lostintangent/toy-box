import { useState } from "react";
import { Plus } from "lucide-react";
import { AutomationDialog } from "./AutomationDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAutomationActions } from "@/hooks/automations/useAutomationActions";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { cn } from "@/lib/utils";
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

  function toggleExpanded() {
    const nextExpanded = !isExpanded;
    if (!nextExpanded) closeDialog();
    onExpandedChange(nextExpanded);
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
    <div className="min-w-0 overflow-hidden border-t">
      <div
        className={cn(
          "flex items-center gap-2 bg-background px-3 py-2",
          isExpanded && "border-b border-border",
        )}
      >
        <button
          type="button"
          aria-label={isExpanded ? "Collapse automations" : "Expand automations"}
          aria-expanded={isExpanded}
          onClick={toggleExpanded}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="section-heading">
            Automations{automations.length > 0 ? ` (${automations.length})` : ""}
          </span>
        </button>

        {isExpanded && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Add automation"
            onClick={openCreateDialog}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div
        aria-hidden={!isExpanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "space-y-3 p-3 transition-transform duration-200 ease-out motion-reduce:transition-none",
              isExpanded ? "translate-y-0" : "-translate-y-1 pointer-events-none",
            )}
          >
            {automations.length === 0 ? (
              <p className="text-xs text-muted-foreground">No automations yet.</p>
            ) : (
              <ul className="max-h-52 min-w-0 space-y-2 overflow-y-auto pr-1">
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
          </div>
        </div>
      </div>

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

      <AlertDialog
        open={deleteTargetAutomation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {deleteTargetAutomation?.title ?? "the automation"}, its schedule, and
              its session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteTargetAutomation}
              onClick={() => {
                if (!deleteTargetAutomation) return;
                void handleDeleteAutomation(deleteTargetAutomation.id);
                setDeleteTargetId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
