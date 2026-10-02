import { useState } from "react";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import type { PlanSection, PlanStep, PlanStepUpdate } from "../model/index";
import { FieldInput, EditorForm, LabeledEditorField, normalizeFieldValues } from "./EditorForm";

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
  onSave: (update: PlanStepUpdate) => string | undefined;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlanStepUpdate>(() => ({
    title: step.title,
    doneWhen: step.doneWhen,
    status: step.status,
    values: step.values,
  }));

  return (
    <EditorForm
      current={step}
      draft={draft}
      onSave={(next) =>
        onSave({
          title: next.title.trim(),
          doneWhen: next.doneWhen.trim(),
          status: next.status,
          values: normalizeFieldValues(section.fields, next.values),
        })
      }
      onCancel={onCancel}
    >
      <LabeledEditorField label="Step">
        {(id) => (
          <Input
            id={id}
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
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
            onChange={(event) =>
              setDraft((current) => ({ ...current, doneWhen: event.target.value }))
            }
            className="min-h-20"
            required
          />
        )}
      </LabeledEditorField>

      <LabeledEditorField label="Status">
        {(id) => (
          <Select
            items={PLAN_STEP_STATUS_OPTIONS}
            value={draft.status ?? "not-started"}
            onValueChange={(status: PlanStepStatusOption) =>
              setDraft((current) => ({
                ...current,
                status: status === "not-started" ? undefined : status,
              }))
            }
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
        <FieldInput
          key={field.id}
          field={field}
          value={draft.values[field.id]}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              values: { ...current.values, [field.id]: value },
            }))
          }
        />
      ))}
    </EditorForm>
  );
}
