import { useId, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/utils";
import {
  BRIEF_CHANGES,
  type BriefField,
  type BriefRecord,
  type Change,
  type SourcePolicy,
} from "../model/index";
import { CHANGE_PRESENTATION } from "../sections/vocabulary";

/** Shared inspector form controls for editing one Brief entity draft. */

/**
 * An entity edit form whose save error stays visible until the draft changes.
 * It refuses to save over `current`, the live authored value, once that value
 * changes underneath the open draft.
 */
export function EditorForm<Draft>({
  current,
  draft,
  onSave,
  onCancel,
  children,
}: {
  current: unknown;
  draft: Draft;
  onSave: (draft: Draft) => string | undefined;
  onCancel: () => void;
  children: ReactNode;
}) {
  const [original] = useState(current);
  const [failure, setFailure] = useState<{ draft: Draft; error: string }>();
  const error = failure?.draft === draft ? failure.error : undefined;

  function save(): string | undefined {
    if (JSON.stringify(current) !== JSON.stringify(original)) {
      return "This changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    return onSave(draft);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const error = save();
        setFailure(error ? { draft, error } : undefined);
      }}
    >
      {children}
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

export function ChangeField({
  value,
  allowExisting,
  onChange,
}: {
  value: Change;
  allowExisting: boolean;
  onChange: (change: Change) => void;
}) {
  const options = BRIEF_CHANGES.filter((change) => allowExisting || change !== "existing").map(
    (change) => ({ value: change, label: CHANGE_PRESENTATION[change].label }),
  );
  return (
    <LabeledEditorField label="Change">
      {(id) => (
        <Select items={options} value={value} onValueChange={(change: Change) => onChange(change)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </LabeledEditorField>
  );
}

export function SourceField({
  sourcePolicy,
  change,
  value,
  onChange,
}: {
  sourcePolicy: SourcePolicy;
  change: Change;
  value?: string;
  onChange: (source: string) => void;
}) {
  return (
    <LabeledEditorField
      label="Source"
      hint={sourcePolicy === "optional" ? "Optional" : "Required unless new"}
    >
      {(id) => (
        <Input
          id={id}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          required={sourcePolicy !== "optional" && change !== "new"}
          placeholder={sourcePlaceholder(sourcePolicy)}
        />
      )}
    </LabeledEditorField>
  );
}

export function sourcePlaceholder(sourcePolicy: SourcePolicy): string {
  return sourcePolicy === "code"
    ? "src/path/file.ts#Symbol"
    : "Code, document, issue, or other useful source";
}

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: BriefField;
  value?: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  if (field.kind === "text") {
    return (
      <LabeledEditorField label={field.label}>
        {(id) => (
          <Textarea
            id={id}
            value={typeof value === "string" ? value : (value?.join(", ") ?? "")}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-20"
            required
          />
        )}
      </LabeledEditorField>
    );
  }

  const selected = Array.isArray(value) ? value : value ? [value] : [];
  if (field.cardinality === "one") {
    return (
      <LabeledEditorField label={field.label}>
        {(id) => (
          <Select
            items={field.options.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            value={selected[0]}
            onValueChange={(optionId) => onChange(optionId)}
          >
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
      </LabeledEditorField>
    );
  }

  return (
    <LabeledEditorField label={field.label} hint="Choose one or more">
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
    </LabeledEditorField>
  );
}

export function LabeledEditorField({
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

export function normalizeFieldValues(
  fields: readonly BriefField[],
  values: BriefRecord["values"],
): BriefRecord["values"] {
  const normalized: BriefRecord["values"] = {};
  for (const field of fields) {
    const value = values[field.id];
    normalized[field.id] =
      typeof value === "string" ? value.trim() : (value?.map((item) => item.trim()) ?? []);
  }
  return normalized;
}
