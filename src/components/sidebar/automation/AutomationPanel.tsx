import { useState } from "react";
import { useHydrated } from "@tanstack/react-router";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type Automation, type AutomationOptions } from "@/types";
import { AutomationListItem } from "./AutomationListItem";

type AutomationPanelProps = {
  automations: Automation[];
  isLoading: boolean;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  openSessionIds: string[];
  onSessionSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onCreateAutomation: (input: AutomationOptions) => Promise<void>;
  onUpdateAutomation: (input: AutomationOptions & { automationId: string }) => Promise<void>;
  onDeleteAutomation: (automationId: string) => Promise<void>;
  onRunAutomation: (automationId: string) => Promise<void>;
  creatingAutomation: boolean;
  updatingAutomationId: string | null;
  deletingAutomationId: string | null;
};

type AutomationDialogState = { mode: "create" } | { mode: "edit"; automationId: string };

export function AutomationPanel({
  automations,
  isLoading,
  isExpanded,
  onExpandedChange,
  openSessionIds,
  onSessionSelect,
  onCreateAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
  onRunAutomation,
  creatingAutomation,
  updatingAutomationId,
  deletingAutomationId,
}: AutomationPanelProps) {
  const hydrated = useHydrated();
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
    : creatingAutomation;
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
            {!hydrated || isLoading ? (
              <AutomationPanelSkeleton />
            ) : automations.length === 0 ? (
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
                        onOpenSession={(sessionId) => onSessionSelect(sessionId, false)}
                        onRun={() => {
                          void onRunAutomation(automation.id);
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
        onCreateAutomation={onCreateAutomation}
        onUpdateAutomation={onUpdateAutomation}
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
                void onDeleteAutomation(deleteTargetAutomation.id);
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

function AutomationPanelSkeleton() {
  return (
    <ul className="min-w-0 space-y-3 px-2 py-1">
      <li>
        <div className="min-w-0 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </li>
    </ul>
  );
}
