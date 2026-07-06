import { useEffect, useId, useMemo, useReducer, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { SessionDirectoryPicker } from "@/components/workspace/panes/session/location/directory/SessionDirectoryPicker";
import {
  findSessionDirectoryOption,
  type SessionDirectoryOption,
} from "@/components/workspace/panes/session/location/directory/directoryOptions";
import { validateAutomationCronDefinition } from "@/lib/automation/cron";
import {
  formatReasoningEffort,
  normalizeModelConfiguration,
  resolveModelConfigurationForModel,
} from "@/lib/modelConfiguration";
import { cn } from "@/lib/utils";
import {
  type Automation,
  type AutomationOptions,
  type ModelConfiguration,
  type ModelInfo,
} from "@/types";
import { AutomationScheduleEditor } from "./AutomationScheduleEditor";

type AutomationFormOptions = Omit<AutomationOptions, "modelConfiguration"> & {
  modelConfiguration: ModelConfiguration | null;
};

export type AutomationDialogMode = "create" | "edit";

type AutomationDialogProps = {
  open: boolean;
  mode: AutomationDialogMode;
  automation: Automation | null;
  models: ModelInfo[];
  defaultModelConfiguration: ModelConfiguration | null;
  directoryOptions: SessionDirectoryOption[];
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateAutomation: (input: AutomationOptions) => Promise<void>;
  onUpdateAutomation: (input: AutomationOptions & { automationId: string }) => Promise<void>;
};

export function AutomationDialog({
  open,
  mode,
  automation,
  models,
  defaultModelConfiguration,
  directoryOptions,
  isSubmitting,
  onOpenChange,
  onCreateAutomation,
  onUpdateAutomation,
}: AutomationDialogProps) {
  const normalizedDefaultModelConfiguration = useMemo(
    () => normalizeModelConfiguration(models, defaultModelConfiguration),
    [defaultModelConfiguration, models],
  );
  const [formState, dispatchForm] = useReducer(automationFormReducer, undefined, () =>
    createAutomationFormState(
      createAutomationFormOptions(mode, automation, models, normalizedDefaultModelConfiguration),
    ),
  );
  const { form, formError } = formState;
  const resetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      resetKeyRef.current = null;
      return;
    }

    const resetKey = mode === "edit" ? `edit:${automation?.id ?? "missing"}` : "create";
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;

    dispatchForm({
      type: "reset",
      form: createAutomationFormOptions(
        mode,
        automation,
        models,
        normalizedDefaultModelConfiguration,
      ),
    });
  }, [automation, mode, models, normalizedDefaultModelConfiguration, open]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    if (form.modelConfiguration) return;
    if (!normalizedDefaultModelConfiguration) return;
    dispatchForm({
      type: "ensureModelConfiguration",
      modelConfiguration: normalizedDefaultModelConfiguration,
    });
  }, [form.modelConfiguration, mode, normalizedDefaultModelConfiguration, open]);

  const formModel = useMemo(
    () => models.find((model) => model.id === form.modelConfiguration?.model),
    [form.modelConfiguration?.model, models],
  );
  const formReasoningEfforts = formModel?.supportedReasoningEfforts ?? [];
  const hasReasoningEffortOptions = formReasoningEfforts.length > 0;
  const selectedReasoningEffort = form.modelConfiguration?.reasoningEffort;
  const cronError = useMemo(() => getCronValidationError(form.cron), [form.cron]);

  const dialogTitle = mode === "edit" ? "Edit automation" : "Create automation";
  const dialogSubmitLabel = mode === "edit" ? "Save" : "Create";

  function updateForm(patch: Partial<AutomationFormOptions>) {
    dispatchForm({ type: "fieldChanged", patch });
  }

  async function handleSubmit() {
    dispatchForm({ type: "submitStarted" });
    if (cronError) return;
    if (!form.modelConfiguration) return;
    if (mode === "edit" && !automation) return;

    const payload = {
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      modelConfiguration: form.modelConfiguration,
      cron: form.cron.trim(),
      reuseSession: form.reuseSession,
      cwd: form.cwd?.trim() || undefined,
    };

    try {
      if (mode === "edit") {
        if (!automation) return;
        await onUpdateAutomation({
          automationId: automation.id,
          ...payload,
        });
      } else {
        await onCreateAutomation(payload);
      }
      onOpenChange(false);
    } catch (error) {
      dispatchForm({
        type: "submitFailed",
        message: getMutationErrorMessage(
          error,
          mode === "create" ? "Failed to create automation." : "Failed to update automation.",
        ),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <AutomationField label="Title">
            {(id) => (
              <Input
                id={id}
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                placeholder="Automation title"
              />
            )}
          </AutomationField>
          <AutomationField label="Prompt">
            {(id) => (
              <Textarea
                id={id}
                value={form.prompt}
                onChange={(event) => updateForm({ prompt: event.target.value })}
                className="min-h-24"
                placeholder="Summarize the repo status and open risks."
              />
            )}
          </AutomationField>
          <div
            className={cn(
              "grid gap-3",
              hasReasoningEffortOptions && "grid-cols-[minmax(0,1fr)_9rem]",
            )}
          >
            <AutomationField label="Model">
              {(id) =>
                form.modelConfiguration ? (
                  <Select
                    value={form.modelConfiguration.model}
                    onValueChange={(model) => {
                      const nextModel = models.find((candidate) => candidate.id === model);
                      dispatchForm({
                        type: "modelChanged",
                        model,
                        modelInfo: nextModel,
                      });
                    }}
                  >
                    <SelectTrigger id={id} className="w-full">
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
                )
              }
            </AutomationField>
            {hasReasoningEffortOptions && selectedReasoningEffort && (
              <AutomationField label="Reasoning effort">
                {(id) => (
                  <Select
                    value={selectedReasoningEffort}
                    onValueChange={(reasoningEffort) =>
                      dispatchForm({
                        type: "reasoningEffortChanged",
                        reasoningEffort,
                      })
                    }
                  >
                    <SelectTrigger id={id} className="w-full">
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
                )}
              </AutomationField>
            )}
          </div>
          <AutomationDirectoryPicker
            value={form.cwd}
            options={directoryOptions}
            onChange={(cwd) => updateForm({ cwd })}
          />
          <AutomationCheckboxField
            label="Reuse session?"
            checked={form.reuseSession}
            onCheckedChange={(reuseSession) => updateForm({ reuseSession })}
          />
          <div className="space-y-1">
            <AutomationScheduleEditor
              value={form.cron}
              onChange={(cron) => updateForm({ cron })}
              error={cronError}
            />
          </div>
        </div>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <DialogFooter>
          <Button
            disabled={
              isSubmitting ||
              form.title.trim().length === 0 ||
              form.prompt.trim().length === 0 ||
              !form.modelConfiguration ||
              !!cronError
            }
            onClick={handleSubmit}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {dialogSubmitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

function createAutomationFormOptions(
  mode: AutomationDialogMode,
  automation: Automation | null,
  models: ModelInfo[],
  defaultModelConfiguration: ModelConfiguration | null,
): AutomationFormOptions {
  if (mode === "edit" && automation) {
    return {
      title: automation.title,
      prompt: automation.prompt,
      modelConfiguration: normalizeModelConfiguration(models, automation.modelConfiguration),
      cron: automation.cron,
      reuseSession: Boolean(automation.reuseSession),
      cwd: automation.cwd,
    };
  }

  return createDefaultAutomationOptions(defaultModelConfiguration);
}

type AutomationFormState = {
  form: AutomationFormOptions;
  formError: string;
};

type AutomationFormAction =
  | { type: "reset"; form: AutomationFormOptions }
  | { type: "fieldChanged"; patch: Partial<AutomationFormOptions> }
  | { type: "modelChanged"; model: string; modelInfo?: ModelInfo }
  | { type: "reasoningEffortChanged"; reasoningEffort: string }
  | { type: "ensureModelConfiguration"; modelConfiguration: ModelConfiguration }
  | { type: "submitStarted" }
  | { type: "submitFailed"; message: string };

function createAutomationFormState(form: AutomationFormOptions): AutomationFormState {
  return { form, formError: "" };
}

function updateAutomationForm(
  state: AutomationFormState,
  patch: Partial<AutomationFormOptions>,
): AutomationFormState {
  return {
    form: { ...state.form, ...patch },
    formError: "",
  };
}

function automationFormReducer(
  state: AutomationFormState,
  action: AutomationFormAction,
): AutomationFormState {
  switch (action.type) {
    case "reset":
      return createAutomationFormState(action.form);

    case "fieldChanged":
      return updateAutomationForm(state, action.patch);

    case "modelChanged":
      return updateAutomationForm(state, {
        modelConfiguration: resolveModelConfigurationForModel(action.modelInfo, {
          ...(state.form.modelConfiguration ?? { model: action.model }),
          model: action.model,
        }),
      });

    case "reasoningEffortChanged":
      return updateAutomationForm(state, {
        modelConfiguration: state.form.modelConfiguration
          ? {
              ...state.form.modelConfiguration,
              reasoningEffort: action.reasoningEffort,
            }
          : null,
      });

    case "ensureModelConfiguration":
      if (state.form.modelConfiguration) return state;
      return {
        ...state,
        form: {
          ...state.form,
          modelConfiguration: action.modelConfiguration,
        },
      };

    case "submitStarted":
      return state.formError ? { ...state, formError: "" } : state;

    case "submitFailed":
      return { ...state, formError: action.message };
  }
}

type AutomationFieldProps = {
  label: string;
  children: (id: string) => ReactNode;
};

function AutomationField({ label, children }: AutomationFieldProps) {
  const id = useId();

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

type AutomationCheckboxFieldProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function AutomationCheckboxField({
  label,
  checked,
  onCheckedChange,
}: AutomationCheckboxFieldProps) {
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
      <label className="cursor-pointer text-sm font-medium" htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

type AutomationDirectoryPickerProps = {
  value?: string;
  options: SessionDirectoryOption[];
  onChange: (cwd?: string) => void;
};

function AutomationDirectoryPicker({ value, options, onChange }: AutomationDirectoryPickerProps) {
  const selectedOption = useMemo(
    () => findSessionDirectoryOption(options, value),
    [options, value],
  );

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Working directory (optional)</p>
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
