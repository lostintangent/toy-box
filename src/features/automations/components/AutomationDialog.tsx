import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { SessionDirectoryPicker } from "@sessions/components/location/directory/SessionDirectoryPicker";
import {
  formatReasoningEffort,
  normalizeModelConfiguration,
  resolveModelConfigurationForModel,
} from "@sessions/model/modelConfiguration";
import { useModels } from "@sessions/useModels";
import { cn } from "@/shared/utils";
import type { ModelInfo } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { automationMutations } from "../mutations";
import {
  type Automation,
  type AutomationOptions,
  validateAutomationCronDefinition,
} from "../model";
import { AutomationScheduleEditor } from "./AutomationScheduleEditor";

type AutomationForm = Omit<AutomationOptions, "model"> & {
  model: ModelConfiguration | null;
};

type AutomationDialogProps =
  | { mode: "create"; automation?: undefined; onOpenChange: (open: boolean) => void }
  | { mode: "edit"; automation: Automation; onOpenChange: (open: boolean) => void };

export function AutomationDialog(props: AutomationDialogProps) {
  const { mode, onOpenChange } = props;
  const automation = mode === "edit" ? props.automation : null;
  const { models, defaultModel } = useModels();
  const saveMutation = useMutation(
    mode === "edit"
      ? automationMutations.update(props.automation.id)
      : automationMutations.create(),
  );
  const [form, setForm] = useState(() =>
    createAutomationForm(mode, automation, models, defaultModel),
  );
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
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cronError) return;
    if (!selectedModel) return;

    saveMutation.mutate(
      {
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        model: selectedModel,
        cron: form.cron.trim(),
        cwd: form.cwd?.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
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
          {saveMutation.error && (
            <p className="text-sm text-destructive">{saveMutation.error.message}</p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                saveMutation.isPending ||
                form.title.trim().length === 0 ||
                form.prompt.trim().length === 0 ||
                !selectedModel ||
                !!cronError
              }
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogSubmitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function createAutomationForm(
  mode: AutomationDialogProps["mode"],
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
