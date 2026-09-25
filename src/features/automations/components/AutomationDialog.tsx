import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";
import { SessionDirectoryPicker } from "@sessions/components/location/directory/SessionDirectoryPicker";
import {
  normalizeModelConfiguration,
  type ModelInfo,
  type ModelConfiguration,
} from "@providers/model";
import { ModelConfigurationPicker } from "@providers/components/ModelPicker";
import { useModels } from "@providers/useModels";
import { automationMutations } from "../mutations";
import {
  type Automation,
  type AutomationOptions,
  type ScheduleDraft,
  cronToSchedule,
  scheduleToCron,
  validateAutomationCronDefinition,
} from "../model";
import { AutomationScheduleEditor } from "./AutomationScheduleEditor";

type AutomationForm = Omit<AutomationOptions, "model" | "cron"> & {
  model: ModelConfiguration | null;
  schedule: ScheduleDraft;
};

export function AutomationDialog({
  automation,
  onOpenChange,
}: {
  automation?: Automation;
  onOpenChange: (open: boolean) => void;
}) {
  const { models, defaultModel } = useModels();
  const saveMutation = useMutation(
    automation ? automationMutations.update(automation.id) : automationMutations.create(),
  );
  const [form, setForm] = useState(() => createAutomationForm(automation, models, defaultModel));
  const selectedModel = form.model ?? (automation ? null : defaultModel);
  const cron = scheduleToCron(form.schedule);
  const cronError = getCronValidationError(cron);

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
        cron: cron.trim(),
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
            <DialogTitle>{automation ? "Edit automation" : "Create automation"}</DialogTitle>
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
            <div className="space-y-1">
              <p className="text-sm font-medium">Model</p>
              {selectedModel ? (
                <div className="flex items-center gap-1 rounded-md border border-border/70 bg-muted/20 p-2">
                  <ModelConfigurationPicker
                    models={models}
                    value={selectedModel}
                    onValueChange={(model) => updateForm({ model })}
                  />
                </div>
              ) : (
                <Skeleton className="h-10 w-full rounded-md" />
              )}
            </div>
            <AutomationDirectoryPicker value={form.cwd} onChange={(cwd) => updateForm({ cwd })} />
            <AutomationScheduleEditor
              value={form.schedule}
              onChange={(schedule) => updateForm({ schedule })}
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
              {automation ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function createAutomationForm(
  automation: Automation | undefined,
  models: ModelInfo[],
  defaultModel: ModelConfiguration | null,
): AutomationForm {
  if (automation) {
    return {
      title: automation.title,
      prompt: automation.prompt,
      model: normalizeModelConfiguration(models, automation.model),
      schedule: cronToSchedule(automation.cron),
      cwd: automation.cwd,
    };
  }

  return {
    title: "",
    prompt: "",
    model: defaultModel,
    schedule: cronToSchedule("0 9 * * *"),
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
