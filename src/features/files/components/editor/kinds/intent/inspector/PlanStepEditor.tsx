import { useState, type FormEvent } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { type PlanSection, type PlanStep, type PlanStepUpdate } from "../model/index";
import {
  cloneFieldValues,
  IntentFieldInput,
  LabeledEditorField,
  normalizeFieldValues,
} from "./FieldEditor";

const PLAN_STEP_STATUS_OPTIONS = [
  { value: "not-started", label: "Not started" },
  { value: "in-progress", label: "In progress" },
  { value: "complete", label: "Complete" },
] as const;

type PlanStepStatusOption = (typeof PLAN_STEP_STATUS_OPTIONS)[number]["value"];

/** Edit one plan step without changing its identity, implementation links, or phase. */
export function PlanStepEditor({
  section,
  step,
  onSave,
  onCancel,
}: {
  section: PlanSection;
  step: PlanStep;
  onSave: (update: PlanStepUpdate, original: PlanStep) => string | undefined;
  onCancel: () => void;
}) {
  const [original] = useState(step);
  const [draft, setDraft] = useState<PlanStepUpdate>(() => ({
    title: step.title,
    doneWhen: step.doneWhen,
    status: step.status,
    values: cloneFieldValues(step.values),
  }));
  const [error, setError] = useState<string>();

  function updateField(fieldId: string, value: string | string[]) {
    setError(undefined);
    setDraft((current) => ({
      ...current,
      values: { ...current.values, [fieldId]: value },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = onSave(
      {
        title: draft.title.trim(),
        doneWhen: draft.doneWhen.trim(),
        status: draft.status,
        values: normalizeFieldValues(section.fields, draft.values),
      },
      original,
    );
    setError(error);
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <LabeledEditorField label="Step">
        {(id) => (
          <Input
            id={id}
            value={draft.title}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, title: event.target.value }));
            }}
            autoFocus
            required
          />
        )}
      </LabeledEditorField>

      <LabeledEditorField label="Done when">
        {(id) => (
          <Textarea
            id={id}
            value={draft.doneWhen}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, doneWhen: event.target.value }));
            }}
            className="min-h-20"
            required
          />
        )}
      </LabeledEditorField>

      <LabeledEditorField label="Status">
        {(id) => (
          <Select
            value={draft.status ?? "not-started"}
            onValueChange={(status: PlanStepStatusOption) => {
              setError(undefined);
              setDraft((current) => ({
                ...current,
                status: status === "not-started" ? undefined : status,
              }));
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_STEP_STATUS_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </LabeledEditorField>

      {section.fields.map((field) => (
        <IntentFieldInput
          key={field.id}
          field={field}
          value={draft.values[field.id]}
          onChange={(value) => updateField(field.id, value)}
        />
      ))}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save changes
        </Button>
      </div>
    </form>
  );
}
