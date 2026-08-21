import { useId, useState, type FormEvent, type ReactNode } from "react";
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
import { cn } from "@/shared/utils";
import {
  INTENT_CHANGES,
  type Change,
  type IntentField,
  type IntentRecord,
  type IntentRecordUpdate,
  type OptionAddition,
  type RecordsSection,
  type SequenceSection,
  type WorkItem,
  type WorkItemUpdate,
} from "./model/index";

const CHANGE_LABEL: Record<Change, string> = {
  existing: "Existing",
  new: "New",
  modified: "Changed",
  removed: "Removed",
  preserved: "Kept",
  renamed: "Renamed",
  split: "Split",
  relocated: "Moved",
};

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
    values: cloneValues(record.values),
    ...(record.explanation ? { explanation: record.explanation } : {}),
    ...(record.provenance ? { provenance: record.provenance } : {}),
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
        <RecordField label={section.subject}>
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
        </RecordField>
      )}

      <RecordField label="Change">
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
                  {CHANGE_LABEL[change]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </RecordField>

      {section.fields.map((field) => (
        <RecordValueField
          key={field.id}
          field={field}
          value={draft.values[field.id]}
          onChange={(value) => updateField(field.id, value)}
        />
      ))}

      <RecordField label="Notes" hint="Optional">
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
      </RecordField>

      <RecordField
        label="Source"
        hint={section.provenance === "optional" ? "Optional" : "Required unless new"}
      >
        {(id) => (
          <Input
            id={id}
            value={draft.provenance ?? ""}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, provenance: event.target.value }));
            }}
            required={section.provenance !== "optional" && draft.change !== "new"}
            placeholder={
              section.provenance === "code"
                ? "src/path/file.ts#Symbol"
                : "Code, document, issue, or other useful source"
            }
          />
        )}
      </RecordField>

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

export function IntentWorkEditor({
  section,
  item,
  onSave,
  onCancel,
}: {
  section: SequenceSection;
  item: WorkItem;
  onSave: (update: WorkItemUpdate, original: WorkItem) => string | undefined;
  onCancel: () => void;
}) {
  const [original] = useState(item);
  const [draft, setDraft] = useState<WorkItemUpdate>(() => ({
    title: item.title,
    values: cloneValues(item.values),
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
        values: normalizeFieldValues(section.fields, draft.values),
      },
      original,
    );
    setError(error);
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <RecordField label="Work">
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
      </RecordField>

      {section.fields.map((field) => (
        <RecordValueField
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

function RecordValueField({
  field,
  value,
  onChange,
}: {
  field: IntentField;
  value?: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  if (field.kind === "text") {
    return (
      <RecordField label={field.label}>
        {(id) => (
          <Textarea
            id={id}
            value={typeof value === "string" ? value : (value?.join(", ") ?? "")}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-20"
            required
          />
        )}
      </RecordField>
    );
  }

  const selected = Array.isArray(value) ? value : value ? [value] : [];
  if (field.cardinality === "one") {
    return (
      <RecordField label={field.label}>
        {(id) => (
          <Select value={selected[0]} onValueChange={(optionId) => onChange(optionId)}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder={`Choose ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </RecordField>
    );
  }

  return (
    <RecordField label={field.label} hint="Choose one or more">
      {() => (
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((option) => {
            const active = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                disabled={active && selected.length === 1}
                title={
                  active && selected.length === 1
                    ? "At least one choice is required."
                    : option.description
                }
                onClick={() =>
                  onChange(
                    active
                      ? selected.filter((optionId) => optionId !== option.id)
                      : [...selected, option.id],
                  )
                }
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </RecordField>
  );
}

function RecordField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs font-medium">
        <span>{label}</span>
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children(id)}
    </div>
  );
}

function cloneValues(values: IntentRecord["values"]): IntentRecord["values"] {
  const clone: IntentRecord["values"] = {};
  for (const [key, value] of Object.entries(values)) {
    clone[key] = Array.isArray(value) ? [...value] : value;
  }
  return clone;
}

function normalizeUpdate(section: RecordsSection, draft: IntentRecordUpdate): IntentRecordUpdate {
  const subject = draft.subject?.trim();
  const explanation = draft.explanation?.trim();
  const provenance = draft.provenance?.trim();
  return {
    ...(section.subject ? { subject: subject ?? "" } : {}),
    change: draft.change,
    values: normalizeFieldValues(section.fields, draft.values),
    ...(explanation ? { explanation } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

function normalizeFieldValues(
  fields: readonly IntentField[],
  values: IntentRecord["values"],
): IntentRecord["values"] {
  const normalized: IntentRecord["values"] = {};
  for (const field of fields) {
    const value = values[field.id];
    normalized[field.id] =
      typeof value === "string" ? value.trim() : (value?.map((item) => item.trim()) ?? []);
  }
  return normalized;
}
