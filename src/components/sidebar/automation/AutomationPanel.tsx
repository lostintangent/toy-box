import { useCallback, useEffect, useMemo, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { AutomationDialog } from "@/components/config/automations/AutomationDialog";
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
import type { SessionDirectoryOption } from "@/components/workspace/panes/session/location/directory/directoryOptions";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  type Automation,
  type AutomationOptions,
  type ModelConfiguration,
  type ModelInfo,
} from "@/types";
import { AutomationListItem } from "./AutomationListItem";

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

export interface AutomationPanelProps {
  automations: Automation[];
  isLoading: boolean;
  models: ModelInfo[];
  defaultModelConfiguration?: ModelConfiguration;
  directoryOptions: SessionDirectoryOption[];
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  activeSessionIds: string[];
  unreadSessionIds: string[];
  onSessionSelect: (sessionId: string | null, modifierKey?: boolean) => void;
  onCreateAutomation: (input: AutomationOptions) => Promise<void>;
  onUpdateAutomation: (input: AutomationOptions & { automationId: string }) => Promise<void>;
  onDeleteAutomation: (automationId: string) => Promise<void>;
  onRunAutomation: (automationId: string) => Promise<void>;
  creatingAutomation?: boolean;
  updatingAutomationId?: string | null;
  deletingAutomationId?: string | null;
  runningAutomationIds?: Set<string>;
}

type AutomationDialogState = { mode: "create" } | { mode: "edit"; automationId: string };

export function AutomationPanel({
  automations,
  isLoading,
  models,
  defaultModelConfiguration,
  directoryOptions,
  isExpanded,
  onExpandedChange,
  activeSessionIds,
  unreadSessionIds,
  onSessionSelect,
  onCreateAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
  onRunAutomation,
  creatingAutomation = false,
  updatingAutomationId = null,
  deletingAutomationId = null,
  runningAutomationIds = new Set<string>(),
}: AutomationPanelProps) {
  const hydrated = useHydrated();
  const automationCount = automations.length;

  const [dialogState, setDialogState] = useState<AutomationDialogState | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const openCreateDialog = useCallback(() => {
    setDialogState({ mode: "create" });
  }, []);

  const openEditDialog = useCallback((automation: Automation) => {
    setDialogState({ mode: "edit", automationId: automation.id });
  }, []);

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeDialog();
    },
    [closeDialog],
  );

  const handleExpandedToggle = useCallback(() => {
    const nextExpanded = !isExpanded;
    if (!nextExpanded) {
      closeDialog();
    }
    onExpandedChange(nextExpanded);
  }, [closeDialog, isExpanded, onExpandedChange]);

  const handleHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleExpandedToggle();
    },
    [handleExpandedToggle],
  );

  const isDialogOpen = dialogState !== null;
  const isEditing = dialogState?.mode === "edit";
  const dialogAutomationId = dialogState?.mode === "edit" ? dialogState.automationId : null;
  const dialogTargetAutomation = useMemo(() => {
    if (!dialogAutomationId) return null;
    return automations.find((automation) => automation.id === dialogAutomationId) ?? null;
  }, [automations, dialogAutomationId]);
  const isDialogSubmitting = isEditing
    ? dialogAutomationId !== null && updatingAutomationId === dialogAutomationId
    : creatingAutomation;
  const deleteTargetAutomation = useMemo(
    () => automations.find((automation) => automation.id === deleteTargetId) ?? null,
    [automations, deleteTargetId],
  );
  const isDeletingTarget = deleteTargetId !== null && deletingAutomationId === deleteTargetId;

  useEffect(() => {
    if (dialogState?.mode !== "edit") return;
    if (dialogTargetAutomation) return;
    closeDialog();
  }, [closeDialog, dialogState, dialogTargetAutomation]);

  useEffect(() => {
    if (deleteTargetId && !deleteTargetAutomation) {
      setDeleteTargetId(null);
    }
  }, [deleteTargetAutomation, deleteTargetId]);

  return (
    <div className="min-w-0 overflow-hidden border-t">
      <div
        role="button"
        tabIndex={0}
        aria-label={isExpanded ? "Collapse automations" : "Expand automations"}
        aria-expanded={isExpanded}
        onClick={handleExpandedToggle}
        onKeyDown={handleHeaderKeyDown}
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 bg-background cursor-pointer",
          isExpanded && "border-b border-border",
        )}
      >
        <span className="section-heading">
          Automations{automationCount > 0 ? ` (${automationCount})` : ""}
        </span>

        {isExpanded && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Add automation"
            onClick={(event) => {
              event.stopPropagation();
              openCreateDialog();
            }}
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
                  const isSelected = Boolean(
                    automation.lastRunSessionId &&
                    activeSessionIds.includes(automation.lastRunSessionId),
                  );
                  const isUnread = Boolean(
                    automation.lastRunSessionId &&
                    unreadSessionIds.includes(automation.lastRunSessionId),
                  );

                  return (
                    <li key={automation.id}>
                      <AutomationListItem
                        automation={automation}
                        isSelected={isSelected}
                        isRunning={runningAutomationIds.has(automation.id)}
                        isUnread={isUnread}
                        isDeleting={deletingAutomationId === automation.id}
                        isUpdating={updatingAutomationId === automation.id}
                        onOpenSession={(sessionId) => onSessionSelect(sessionId, false)}
                        onRun={() => {
                          void onRunAutomation(automation.id);
                        }}
                        onEdit={() => {
                          openEditDialog(automation);
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
        models={models}
        defaultModelConfiguration={defaultModelConfiguration ?? null}
        directoryOptions={directoryOptions}
        isSubmitting={isDialogSubmitting}
        onOpenChange={handleDialogOpenChange}
        onCreateAutomation={onCreateAutomation}
        onUpdateAutomation={onUpdateAutomation}
      />

      <AlertDialog
        open={deleteTargetId !== null}
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
              This removes {deleteTargetAutomation?.title ?? "the automation"} schedule. Existing
              sessions remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingTarget || !deleteTargetId}
              onClick={() => {
                if (!deleteTargetId) return;
                void onDeleteAutomation(deleteTargetId);
                setDeleteTargetId(null);
              }}
            >
              {isDeletingTarget && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
