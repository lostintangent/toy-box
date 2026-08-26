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
import {
  INTENT_CHANGES,
  type Change,
  type IntentRecord,
  type IntentRecordUpdate,
  type OptionAddition,
  type RecordsSection,
} from "../model/index";
import {
  cloneFieldValues,
  CHANGE_EDITOR_LABELS,
  IntentFieldInput,
  LabeledEditorField,
  normalizeFieldValues,
} from "./FieldEditor";

export function IntentRecordEditor({
  section,
  record,
  onSave,
  onCancel,
}: {
  section: RecordsSection;
  record: IntentRecord | OptionAddition;
  onSave: (
    update: IntentRecordUpdate,
    original: IntentRecord | OptionAddition,
  ) => string | undefined;
  onCancel: () => void;
}) {
  const [original] = useState(record);
  const [draft, setDraft] = useState<IntentRecordUpdate>(() => ({
    ...(record.subject ? { subject: record.subject } : {}),
    change: record.change,
    values: cloneFieldValues(record.values),
    ...(record.explanation ? { explanation: record.explanation } : {}),
    ...(record.source ? { source: record.source } : {}),
  }));
  const [error, setError] = useState<string>();
  const allowedChanges =
    "sectionId" in record
      ? INTENT_CHANGES.filter((change) => change !== "existing")
      : INTENT_CHANGES;

  function updateField(fieldId: string, value: string | string[]) {
    setError(undefined);
    setDraft((current) => ({
      ...current,
      values: { ...current.values, [fieldId]: value },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = onSave(normalizeUpdate(section, draft), original);
    setError(error);
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {section.subject && (
        <LabeledEditorField label={section.subject}>
          {(id) => (
            <Input
              id={id}
              value={draft.subject ?? ""}
              onChange={(event) => {
                setError(undefined);
                setDraft((current) => ({ ...current, subject: event.target.value }));
              }}
              autoFocus
              required
            />
          )}
        </LabeledEditorField>
      )}

      <LabeledEditorField label="Change">
        {(id) => (
          <Select
            value={draft.change}
            onValueChange={(change: Change) => {
              setError(undefined);
              setDraft((current) => ({ ...current, change }));
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedChanges.map((change) => (
                <SelectItem key={change} value={change}>
                  {CHANGE_EDITOR_LABELS[change]}
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

      <LabeledEditorField label="Notes" hint="Optional">
        {(id) => (
          <Textarea
            id={id}
            value={draft.explanation ?? ""}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, explanation: event.target.value }));
            }}
            placeholder="Add context that helps someone make sense of this."
          />
        )}
      </LabeledEditorField>

      <LabeledEditorField
        label="Source"
        hint={section.sourcePolicy === "optional" ? "Optional" : "Required unless new"}
      >
        {(id) => (
          <Input
            id={id}
            value={draft.source ?? ""}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, source: event.target.value }));
            }}
            required={section.sourcePolicy !== "optional" && draft.change !== "new"}
            placeholder={
              section.sourcePolicy === "code"
                ? "src/path/file.ts#Symbol"
                : "Code, document, issue, or other useful source"
            }
          />
        )}
      </LabeledEditorField>

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

function normalizeUpdate(section: RecordsSection, draft: IntentRecordUpdate): IntentRecordUpdate {
  const subject = draft.subject?.trim();
  const explanation = draft.explanation?.trim();
  const source = draft.source?.trim();
  return {
    ...(section.subject ? { subject: subject ?? "" } : {}),
    change: draft.change,
    values: normalizeFieldValues(section.fields, draft.values),
    ...(explanation ? { explanation } : {}),
    ...(source ? { source } : {}),
  };
}
