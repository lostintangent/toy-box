import { useCallback, useEffect, useMemo, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SessionDirectoryPicker } from "@/components/session/SessionDirectoryPicker";
import {
  findSessionDirectoryOption,
  type SessionDirectoryOption,
} from "@/components/session/sessionDirectoryOptions";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { validateAutomationCronDefinition } from "@/lib/automation/cron";
import { cn } from "@/lib/utils";
import {
  formatReasoningEffort,
  normalizeModelConfiguration,
  resolveModelConfigurationForModel,
} from "@/lib/modelConfiguration";
import {
  type Automation,
  type AutomationOptions,
  type ModelConfiguration,
  type ModelInfo,
} from "@/types";
import { AutomationListItem } from "./AutomationListItem";
import { AutomationScheduleEditor } from "./AutomationScheduleEditor";

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

type AutomationMutationError = {
  message?: string;
};

function getMutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as AutomationMutationError).message === "string"
  ) {
    return (error as AutomationMutationError).message!;
  }
  return fallback;
}

function getCronValidationError(cron: string): string | null {
  const value = cron.trim();
  if (value.length === 0) return "Cron is required.";

  try {
    validateAutomationCronDefinition(value);
    return null;
  } catch {
    return "Enter a valid 5-field cron expression.";
  }
}

type AutomationFormOptions = Omit<AutomationOptions, "modelConfiguration"> & {
  modelConfiguration: ModelConfiguration | null;
};

function createDefaultAutomationOptions(
  defaultModelConfiguration: ModelConfiguration | null,
): AutomationFormOptions {
  return {
    title: "",
    prompt: "",
    modelConfiguration: defaultModelConfiguration,
    cron: "0 9 * * *",
    reuseSession: true,
    cwd: undefined,
  };
}

type AutomationDirectoryPickerProps = {
  idPrefix: string;
  value?: string;
  options: SessionDirectoryOption[];
  onChange: (cwd?: string) => void;
};

function AutomationDirectoryPicker({
  idPrefix,
  value,
  options,
  onChange,
}: AutomationDirectoryPickerProps) {
  const selectedOption = useMemo(
    () => findSessionDirectoryOption(options, value),
    [options, value],
  );

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={`${idPrefix}-cwd-picker`}>
        Working directory (optional)
      </label>
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 p-1">
        <SessionDirectoryPicker
          value={value}
          repository={selectedOption?.repository}
          gitRoot={selectedOption?.gitRoot}
          options={options}
          onValueChange={(cwd) => onChange(cwd)}
          className="h-8 min-w-0 flex-1 max-w-none justify-start px-2 text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2"
          disabled={!value}
          onClick={() => onChange(undefined)}
        >
          Clear
        </Button>
      </div>
    </div>
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
  const resolvedDefaultModelConfiguration = useMemo(() => {
    return normalizeModelConfiguration(models, defaultModelConfiguration);
  }, [defaultModelConfiguration, models]);

  const [dialogState, setDialogState] = useState<AutomationDialogState | null>(null);
  const [form, setForm] = useState<AutomationFormOptions>(() =>
    createDefaultAutomationOptions(resolvedDefaultModelConfiguration),
  );
  const [formError, setFormError] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const resetDialogState = useCallback(() => {
    setFormError("");
    setForm(createDefaultAutomationOptions(resolvedDefaultModelConfiguration));
  }, [resolvedDefaultModelConfiguration]);

  const closeDialog = useCallback(() => {
    setDialogState(null);
    resetDialogState();
  }, [resetDialogState]);

  const openCreateDialog = useCallback(() => {
    setDialogState({ mode: "create" });
    resetDialogState();
  }, [resetDialogState]);

  const openEditDialog = useCallback(
    (automation: Automation) => {
      const modelConfiguration = normalizeModelConfiguration(models, automation.modelConfiguration);

      setDialogState({ mode: "edit", automationId: automation.id });
      setForm({
        title: automation.title,
        prompt: automation.prompt,
        modelConfiguration,
        cron: automation.cron,
        reuseSession: Boolean(automation.reuseSession),
        cwd: automation.cwd,
      });
      setFormError("");
    },
    [models],
  );

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
  const dialogTitle = isEditing ? "Edit automation" : "Create automation";
  const dialogSubmitLabel = isEditing ? "Save" : "Create";
  const dialogIdPrefix = isEditing
    ? `automation-edit-${dialogAutomationId ?? "automation"}`
    : "automation-create";
  const isDialogSubmitting = isEditing
    ? dialogAutomationId !== null && updatingAutomationId === dialogAutomationId
    : creatingAutomation;
  const formModel = useMemo(
    () => models.find((model) => model.id === form.modelConfiguration?.model),
    [form.modelConfiguration?.model, models],
  );
  const formReasoningEfforts = formModel?.supportedReasoningEfforts ?? [];
  const hasReasoningEffortOptions = formReasoningEfforts.length > 0;

  const cronError = useMemo(() => getCronValidationError(form.cron), [form.cron]);
  const deleteTargetAutomation = useMemo(
    () => automations.find((automation) => automation.id === deleteTargetId) ?? null,
    [automations, deleteTargetId],
  );
  const isDeletingTarget = deleteTargetId !== null && deletingAutomationId === deleteTargetId;

  const handleDialogSubmit = async () => {
    if (!dialogState) return;
    setFormError("");
    if (cronError) return;
    if (!form.modelConfiguration) return;

    const payload = {
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      modelConfiguration: form.modelConfiguration,
      cron: form.cron.trim(),
      reuseSession: form.reuseSession,
      cwd: form.cwd?.trim() || undefined,
    };

    try {
      if (dialogState.mode === "create") {
        await onCreateAutomation(payload);
      } else {
        await onUpdateAutomation({
          automationId: dialogState.automationId,
          ...payload,
        });
      }
      closeDialog();
    } catch (error) {
      setFormError(
        getMutationErrorMessage(
          error,
          dialogState.mode === "create"
            ? "Failed to create automation."
            : "Failed to update automation.",
        ),
      );
    }
  };

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

  useEffect(() => {
    if (dialogState?.mode !== "create") return;
    if (form.modelConfiguration) return;
    if (!resolvedDefaultModelConfiguration) return;
    setForm((current) => ({
      ...current,
      modelConfiguration: resolvedDefaultModelConfiguration,
    }));
  }, [dialogState, form.modelConfiguration, resolvedDefaultModelConfiguration]);

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
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">
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

      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor={`${dialogIdPrefix}-title`}>
                Title
              </label>
              <Input
                id={`${dialogIdPrefix}-title`}
                value={form.title}
                onChange={(event) => {
                  setFormError("");
                  setForm((prev) => ({ ...prev, title: event.target.value }));
                }}
                placeholder="Automation title"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor={`${dialogIdPrefix}-prompt`}>
                Prompt
              </label>
              <Textarea
                id={`${dialogIdPrefix}-prompt`}
                value={form.prompt}
                onChange={(event) => {
                  setFormError("");
                  setForm((prev) => ({ ...prev, prompt: event.target.value }));
                }}
                className="min-h-24"
                placeholder="Summarize the repo status and open risks."
              />
            </div>
            <div
              className={cn(
                "grid gap-3",
                hasReasoningEffortOptions && "grid-cols-[minmax(0,1fr)_9rem]",
              )}
            >
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`${dialogIdPrefix}-model`}>
                  Model
                </label>
                {form.modelConfiguration ? (
                  <Select
                    value={form.modelConfiguration.model}
                    onValueChange={(model) => {
                      setFormError("");
                      const nextModel = models.find((candidate) => candidate.id === model);
                      setForm((prev) => ({
                        ...prev,
                        modelConfiguration: resolveModelConfigurationForModel(nextModel, {
                          ...(prev.modelConfiguration ?? { model }),
                          model,
                        }),
                      }));
                    }}
                  >
                    <SelectTrigger id={`${dialogIdPrefix}-model`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Skeleton className="h-10 w-full rounded-md" />
                )}
              </div>
              {hasReasoningEffortOptions && form.modelConfiguration?.reasoningEffort && (
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={`${dialogIdPrefix}-effort`}>
                    Reasoning effort
                  </label>
                  <Select
                    value={form.modelConfiguration.reasoningEffort}
                    onValueChange={(value) => {
                      setFormError("");
                      setForm((prev) => ({
                        ...prev,
                        modelConfiguration: prev.modelConfiguration
                          ? {
                              ...prev.modelConfiguration,
                              reasoningEffort: value,
                            }
                          : null,
                      }));
                    }}
                  >
                    <SelectTrigger id={`${dialogIdPrefix}-effort`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formReasoningEfforts.map((effort) => (
                        <SelectItem key={effort} value={effort}>
                          {formatReasoningEffort(effort)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <AutomationDirectoryPicker
              idPrefix={dialogIdPrefix}
              value={form.cwd}
              options={directoryOptions}
              onChange={(cwd) => {
                setFormError("");
                setForm((prev) => ({ ...prev, cwd }));
              }}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${dialogIdPrefix}-reuse-session`}
                checked={form.reuseSession}
                onCheckedChange={(checked) => {
                  setFormError("");
                  setForm((prev) => ({ ...prev, reuseSession: checked === true }));
                }}
              />
              <label
                className="cursor-pointer text-sm font-medium"
                htmlFor={`${dialogIdPrefix}-reuse-session`}
              >
                Reuse session?
              </label>
            </div>
            <div className="space-y-1">
              <AutomationScheduleEditor
                idPrefix={dialogIdPrefix}
                value={form.cron}
                onChange={(cron) => {
                  setFormError("");
                  setForm((prev) => ({ ...prev, cron }));
                }}
                error={cronError}
              />
            </div>
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button
              disabled={
                isDialogSubmitting ||
                form.title.trim().length === 0 ||
                form.prompt.trim().length === 0 ||
                !form.modelConfiguration ||
                !!cronError
              }
              onClick={handleDialogSubmit}
            >
              {isDialogSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
