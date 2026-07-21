import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { validateAutomationCronDefinition } from "@/lib/automation/cron";
import {
  formatReasoningEffort,
  normalizeModelConfiguration,
  resolveModelConfigurationForModel,
} from "@/lib/modelConfiguration";
import { useModels } from "@/hooks/workspace/useModels";
import { cn } from "@/lib/utils";
import {
  type Automation,
  type AutomationOptions,
  type ModelConfiguration,
  type ModelInfo,
} from "@/types";
import { AutomationScheduleEditor } from "./AutomationScheduleEditor";

type AutomationForm = Omit<AutomationOptions, "model"> & {
  model: ModelConfiguration | null;
};

type AutomationDialogMode = "create" | "edit";

export function AutomationDialog({
  open,
  mode,
  automation,
  isSubmitting,
  onOpenChange,
  onCreateAutomation,
  onUpdateAutomation,
}: {
  open: boolean;
  mode: AutomationDialogMode;
  automation: Automation | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateAutomation: (input: AutomationOptions) => Promise<void>;
  onUpdateAutomation: (input: AutomationOptions & { automationId: string }) => Promise<void>;
}) {
  const { models, defaultModel } = useModels();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <AutomationDialogForm
          mode={mode}
          automation={automation}
          isSubmitting={isSubmitting}
          models={models}
          defaultModel={defaultModel}
          onOpenChange={onOpenChange}
          onCreateAutomation={onCreateAutomation}
          onUpdateAutomation={onUpdateAutomation}
        />
      </DialogContent>
    </Dialog>
  );
}

function AutomationDialogForm({
  mode,
  automation,
  isSubmitting,
  models,
  defaultModel,
  onOpenChange,
  onCreateAutomation,
  onUpdateAutomation,
}: {
  mode: AutomationDialogMode;
  automation: Automation | null;
  isSubmitting: boolean;
  models: ModelInfo[];
  defaultModel: ModelConfiguration | null;
  onOpenChange: (open: boolean) => void;
  onCreateAutomation: (input: AutomationOptions) => Promise<void>;
  onUpdateAutomation: (input: AutomationOptions & { automationId: string }) => Promise<void>;
}) {
  const [form, setForm] = useState(() =>
    createAutomationForm(mode, automation, models, defaultModel),
  );
  const [formError, setFormError] = useState("");
  const selectedModel = form.model ?? (mode === "create" ? defaultModel : null);
  const formModel = models.find((model) => model.id === selectedModel?.name);
  const formReasoningEfforts = formModel?.supportedReasoningEfforts ?? [];
  const hasReasoningEffortOptions = formReasoningEfforts.length > 0;
  const selectedReasoningEffort = selectedModel?.reasoningEffort;
  const cronError = getCronValidationError(form.cron);

  const dialogTitle = mode === "edit" ? "Edit automation" : "Create automation";
  const dialogSubmitLabel = mode === "edit" ? "Save" : "Create";

  function updateForm(patch: Partial<AutomationForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setFormError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (cronError) return;
    if (!selectedModel) return;
    if (mode === "edit" && !automation) return;

    const payload = {
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      model: selectedModel,
      cron: form.cron.trim(),
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
      setFormError(
        getMutationErrorMessage(
          error,
          mode === "create" ? "Failed to create automation." : "Failed to update automation.",
        ),
      );
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
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
              selectedModel ? (
                <Select
                  value={selectedModel.name}
                  onValueChange={(modelId) => {
                    const modelInfo = models.find((candidate) => candidate.id === modelId);
                    updateForm({
                      model: resolveModelConfigurationForModel(modelInfo, {
                        ...selectedModel,
                        name: modelId,
                      }),
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
                    updateForm({
                      model: selectedModel ? { ...selectedModel, reasoningEffort } : null,
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
        <AutomationDirectoryPicker value={form.cwd} onChange={(cwd) => updateForm({ cwd })} />
        <AutomationScheduleEditor
          value={form.cron}
          onChange={(cron) => updateForm({ cron })}
          error={cronError}
        />
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <DialogFooter>
        <Button
          type="submit"
          disabled={
            isSubmitting ||
            form.title.trim().length === 0 ||
            form.prompt.trim().length === 0 ||
            !selectedModel ||
            !!cronError
          }
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {dialogSubmitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function createAutomationForm(
  mode: AutomationDialogMode,
  automation: Automation | null,
  models: ModelInfo[],
  defaultModel: ModelConfiguration | null,
): AutomationForm {
  if (mode === "edit" && automation) {
    return {
      title: automation.title,
      prompt: automation.prompt,
      model: normalizeModelConfiguration(models, automation.model),
      cron: automation.cron,
      cwd: automation.cwd,
    };
  }

  return {
    title: "",
    prompt: "",
    model: defaultModel,
    cron: "0 9 * * *",
    cwd: undefined,
  };
}

function AutomationField({
  label,
  children,
}: {
  label: string;
  children: (id: string) => ReactNode;
}) {
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

function AutomationDirectoryPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (cwd?: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Working directory (optional)</p>
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 p-1">
        <SessionDirectoryPicker
          value={value ?? null}
          onValueChange={(cwd) => onChange(cwd ?? undefined)}
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

function getMutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
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
