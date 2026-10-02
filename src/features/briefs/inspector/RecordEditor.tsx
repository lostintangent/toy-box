import { useState } from "react";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import type { BriefRecord, RecordsSection, RecordUpdate } from "../model/index";
import {
  FieldInput,
  ChangeField,
  EditorForm,
  LabeledEditorField,
  normalizeFieldValues,
  SourceField,
} from "./EditorForm";

export function RecordEditor({
  section,
  record,
  onSave,
  onCancel,
}: {
  section: RecordsSection;
  record: BriefRecord;
  onSave: (update: RecordUpdate) => string | undefined;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecordUpdate>(() => ({
    ...(record.subject ? { subject: record.subject } : {}),
    change: record.change,
    values: record.values,
    ...(record.explanation ? { explanation: record.explanation } : {}),
    ...(record.source ? { source: record.source } : {}),
  }));

  return (
    <EditorForm
      current={record}
      draft={draft}
      onSave={(next) => onSave(normalizeUpdate(section, next))}
      onCancel={onCancel}
    >
      {section.subject && (
        <LabeledEditorField label={section.subject}>
          {(id) => (
            <Input
              id={id}
              value={draft.subject ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, subject: event.target.value }))
              }
              autoFocus
              required
            />
          )}
        </LabeledEditorField>
      )}

      <ChangeField
        value={draft.change}
        allowExisting={!("sectionId" in record)}
        onChange={(change) => setDraft((current) => ({ ...current, change }))}
      />

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

      <LabeledEditorField label="Notes" hint="Optional">
        {(id) => (
          <Textarea
            id={id}
            value={draft.explanation ?? ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, explanation: event.target.value }))
            }
            placeholder="Add context that helps someone make sense of this."
          />
        )}
      </LabeledEditorField>

      <SourceField
        sourcePolicy={section.sourcePolicy}
        change={draft.change}
        value={draft.source}
        onChange={(source) => setDraft((current) => ({ ...current, source }))}
      />
    </EditorForm>
  );
}

function normalizeUpdate(section: RecordsSection, draft: RecordUpdate): RecordUpdate {
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
