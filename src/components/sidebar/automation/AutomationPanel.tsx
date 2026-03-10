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
import {
  cronToSimpleSchedule,
  DEFAULT_SIMPLE_SCHEDULE,
  normalizeSimpleSchedule,
  simpleScheduleToCron,
  type SimpleSchedule,
  type SimpleScheduleKind,
  WEEKDAY_OPTIONS,
} from "@/lib/automation/schedule";
import { cn } from "@/lib/utils";
import type { Automation, AutomationOptions, ModelInfo } from "@/types";
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

function createDefaultAutomationOptions(defaultModelId = ""): AutomationOptions {
  return {
    title: "",
    prompt: "",
    model: defaultModelId,
    cron: "0 9 * * *",
    reuseSession: true,
    cwd: undefined,
  };
}

type ScheduleInputMode = SimpleScheduleKind | "cron";

function parseIntegerInput(value: string): number {
  if (value.trim().length === 0) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimeValue(hour: number, minute: number): string {
  const normalizedHour = Math.min(23, Math.max(0, Math.round(hour)));
  const normalizedMinute = Math.min(59, Math.max(0, Math.round(minute)));
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

function parseTimeValue(value: string): { hour: number; minute: number } | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function toggleWeekday(daysOfWeek: number[], dayOfWeek: number): number[] {
  const hasDay = daysOfWeek.includes(dayOfWeek);
  if (hasDay && daysOfWeek.length === 1) return daysOfWeek;
  if (hasDay) return daysOfWeek.filter((value) => value !== dayOfWeek);
  return [...daysOfWeek, dayOfWeek].sort((a, b) => a - b);
}

function ensureScheduleMode(
  schedule: SimpleSchedule,
  mode: Exclude<ScheduleInputMode, "cron">,
): SimpleSchedule {
  const normalized = normalizeSimpleSchedule({
    ...schedule,
    kind: mode,
  });
  if (mode === "interval") {
    return {
      ...normalized,
      minute: 0,
    };
  }
  return normalized;
}

function getUnsupportedCronHint(): string {
  return "This cron uses advanced syntax and can only be edited in cron mode.";
}

function getSimpleResetHint(): string {
  return "Current cron could not be represented. Starting from a daily schedule.";
}

type WeekdaySelectorProps = {
  idPrefix: string;
  selectedDays: number[];
  onChange: (nextDays: number[]) => void;
};

function WeekdaySelector({ idPrefix, selectedDays, onChange }: WeekdaySelectorProps) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-sm font-medium" id={`${idPrefix}-days-label`}>
        Days
      </p>
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-labelledby={`${idPrefix}-days-label`}
      >
        {WEEKDAY_OPTIONS.map((option) => {
          const isSelected = selectedDays.includes(option.value);
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={isSelected ? "secondary" : "outline"}
              className="h-7 px-2 text-xs transition-none"
              aria-pressed={isSelected}
              onClick={() => onChange(toggleWeekday(selectedDays, option.value))}
            >
              {option.label.slice(0, 3)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

type ScheduleEditorProps = {
  idPrefix: string;
  mode: ScheduleInputMode;
  onModeChange: (mode: ScheduleInputMode) => void;
  cronValue: string;
  onCronChange: (cron: string) => void;
  simpleSchedule: SimpleSchedule;
  onSimpleScheduleChange: (schedule: SimpleSchedule) => void;
  cronError: string | null;
  modeHint?: string | null;
};

function ScheduleEditor({
  idPrefix,
  mode,
  onModeChange,
  cronValue,
  onCronChange,
  simpleSchedule,
  onSimpleScheduleChange,
  cronError,
  modeHint,
}: ScheduleEditorProps) {
  const normalizedSimpleSchedule = normalizeSimpleSchedule(simpleSchedule);

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-border/70 bg-muted/30 p-0.5">
        <Button
          type="button"
          size="sm"
          variant={mode === "daily" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => onModeChange("daily")}
        >
          Daily
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "interval" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => onModeChange("interval")}
        >
          Interval
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "cron" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => onModeChange("cron")}
        >
          Cron
        </Button>
      </div>

      {modeHint && <p className="text-xs text-muted-foreground">{modeHint}</p>}

      {mode === "daily" ? (
        <div className="rounded-md border border-border/70 p-2">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
            <div className="shrink-0">
              <label className="mb-1 block text-sm font-medium" htmlFor={`${idPrefix}-daily-time`}>
                Time
              </label>
              <Input
                id={`${idPrefix}-daily-time`}
                type="time"
                step={60}
                className="w-24"
                value={formatTimeValue(
                  normalizedSimpleSchedule.hour,
                  normalizedSimpleSchedule.minute,
                )}
                onChange={(event) => {
                  const parsed = parseTimeValue(event.target.value);
                  if (!parsed) return;
                  onSimpleScheduleChange(
                    ensureScheduleMode(
                      {
                        ...normalizedSimpleSchedule,
                        hour: parsed.hour,
                        minute: parsed.minute,
                      },
                      "daily",
                    ),
                  );
                }}
              />
            </div>

            <WeekdaySelector
              idPrefix={`${idPrefix}-daily`}
              selectedDays={normalizedSimpleSchedule.daysOfWeek}
              onChange={(nextDays) =>
                onSimpleScheduleChange(
                  ensureScheduleMode(
                    {
                      ...normalizedSimpleSchedule,
                      daysOfWeek: nextDays,
                    },
                    "daily",
                  ),
                )
              }
            />
          </div>
        </div>
      ) : mode === "interval" ? (
        <div className="rounded-md border border-border/70 p-2">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
            <div className="w-28 shrink-0 space-y-1">
              <label className="text-sm font-medium" htmlFor={`${idPrefix}-interval-hours`}>
                Every
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${idPrefix}-interval-hours`}
                  type="number"
                  min={1}
                  max={24}
                  value={normalizedSimpleSchedule.intervalHours}
                  onChange={(event) =>
                    onSimpleScheduleChange(
                      ensureScheduleMode(
                        {
                          ...normalizedSimpleSchedule,
                          intervalHours: parseIntegerInput(event.target.value),
                        },
                        "interval",
                      ),
                    )
                  }
                />
                <span className="text-sm text-muted-foreground shrink-0">hours</span>
              </div>
            </div>

            <WeekdaySelector
              idPrefix={`${idPrefix}-interval`}
              selectedDays={normalizedSimpleSchedule.daysOfWeek}
              onChange={(nextDays) =>
                onSimpleScheduleChange(
                  ensureScheduleMode(
                    {
                      ...normalizedSimpleSchedule,
                      daysOfWeek: nextDays,
                    },
                    "interval",
                  ),
                )
              }
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${idPrefix}-cron`}>
            Cron
          </label>
          <Input
            id={`${idPrefix}-cron`}
            value={cronValue}
            onChange={(event) => onCronChange(event.target.value)}
            placeholder="0 * * * *"
          />
          <p className="text-xs text-muted-foreground">Uses the server's local timezone.</p>
        </div>
      )}

      {cronError && <p className="text-xs text-destructive">{cronError}</p>}
    </div>
  );
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
  defaultModelId?: string;
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
  defaultModelId = "",
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
  const resolvedDefaultModelId = useMemo(() => {
    if (models.length === 0) return "";
    if (defaultModelId.length > 0 && models.some((model) => model.id === defaultModelId)) {
      return defaultModelId;
    }
    return models[0].id;
  }, [defaultModelId, models]);

  const [dialogState, setDialogState] = useState<AutomationDialogState | null>(null);
  const [form, setForm] = useState<AutomationOptions>(() =>
    createDefaultAutomationOptions(resolvedDefaultModelId),
  );
  const [formError, setFormError] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleInputMode>("daily");
  const [simpleSchedule, setSimpleSchedule] = useState<SimpleSchedule>(DEFAULT_SIMPLE_SCHEDULE);
  const [modeHint, setModeHint] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const resetDialogState = useCallback(() => {
    setFormError("");
    setForm(createDefaultAutomationOptions(resolvedDefaultModelId));
    setScheduleMode("daily");
    setSimpleSchedule(DEFAULT_SIMPLE_SCHEDULE);
    setModeHint(null);
  }, [resolvedDefaultModelId]);

  const closeDialog = useCallback(() => {
    setDialogState(null);
    resetDialogState();
  }, [resetDialogState]);

  const openCreateDialog = useCallback(() => {
    setDialogState({ mode: "create" });
    resetDialogState();
  }, [resetDialogState]);

  const openEditDialog = useCallback((automation: Automation) => {
    const parsed = cronToSimpleSchedule(automation.cron);
    setDialogState({ mode: "edit", automationId: automation.id });
    setForm({
      title: automation.title,
      prompt: automation.prompt,
      model: automation.model,
      cron: automation.cron,
      reuseSession: Boolean(automation.reuseSession),
      cwd: automation.cwd,
    });
    setScheduleMode(parsed ? parsed.kind : "cron");
    setSimpleSchedule(parsed ?? DEFAULT_SIMPLE_SCHEDULE);
    setModeHint(parsed ? null : getUnsupportedCronHint());
    setFormError("");
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
  const dialogTitle = isEditing ? "Edit automation" : "Create automation";
  const dialogSubmitLabel = isEditing ? "Save" : "Create";
  const dialogIdPrefix = isEditing
    ? `automation-edit-${dialogAutomationId ?? "automation"}`
    : "automation-create";
  const isDialogSubmitting = isEditing
    ? dialogAutomationId !== null && updatingAutomationId === dialogAutomationId
    : creatingAutomation;

  const effectiveCron = useMemo(
    () =>
      scheduleMode === "cron"
        ? form.cron
        : simpleScheduleToCron(ensureScheduleMode(simpleSchedule, scheduleMode)),
    [form.cron, scheduleMode, simpleSchedule],
  );
  const cronError = useMemo(() => getCronValidationError(effectiveCron), [effectiveCron]);
  const deleteTargetAutomation = useMemo(
    () => automations.find((automation) => automation.id === deleteTargetId) ?? null,
    [automations, deleteTargetId],
  );
  const isDeletingTarget = deleteTargetId !== null && deletingAutomationId === deleteTargetId;

  const handleScheduleModeChange = useCallback(
    (mode: ScheduleInputMode) => {
      setFormError("");
      setModeHint(null);

      if (mode === "cron") {
        setForm((prev) => ({
          ...prev,
          cron: simpleScheduleToCron(
            ensureScheduleMode(simpleSchedule, scheduleMode === "cron" ? "daily" : scheduleMode),
          ),
        }));
        setScheduleMode("cron");
        return;
      }

      if (scheduleMode === "cron") {
        const parsed = cronToSimpleSchedule(form.cron);
        if (parsed) {
          setSimpleSchedule(ensureScheduleMode(parsed, mode));
        } else {
          setSimpleSchedule(ensureScheduleMode(DEFAULT_SIMPLE_SCHEDULE, mode));
          if (form.cron.trim().length > 0) {
            setModeHint(getSimpleResetHint());
          }
        }
      } else {
        setSimpleSchedule((current) => ensureScheduleMode(current, mode));
      }

      setScheduleMode(mode);
    },
    [form.cron, scheduleMode, simpleSchedule],
  );

  const handleDialogSubmit = async () => {
    if (!dialogState) return;
    setFormError("");
    if (cronError) return;

    const payload = {
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      model: form.model,
      cron: effectiveCron.trim(),
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
    if (form.model.length > 0) return;
    if (resolvedDefaultModelId.length === 0) return;
    setForm((current) => ({ ...current, model: resolvedDefaultModelId }));
  }, [dialogState, form.model, resolvedDefaultModelId]);

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
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor={`${dialogIdPrefix}-model`}>
                Model
              </label>
              <Select
                value={form.model}
                onValueChange={(model) => {
                  setFormError("");
                  setForm((prev) => ({ ...prev, model }));
                }}
              >
                <SelectTrigger id={`${dialogIdPrefix}-model`} className="w-full">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <ScheduleEditor
                idPrefix={dialogIdPrefix}
                mode={scheduleMode}
                onModeChange={handleScheduleModeChange}
                cronValue={form.cron}
                onCronChange={(cron) => {
                  setFormError("");
                  setModeHint(null);
                  setForm((prev) => ({ ...prev, cron }));
                }}
                simpleSchedule={simpleSchedule}
                onSimpleScheduleChange={(schedule) => {
                  setFormError("");
                  setModeHint(null);
                  setSimpleSchedule(schedule);
                }}
                cronError={cronError}
                modeHint={modeHint}
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
                form.model.length === 0 ||
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
