import { useId, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";
import type { Change, IntentField, IntentRecord } from "../model/index";

/** Shared form controls for values declared by an Intent section's fields. */

export const CHANGE_EDITOR_LABELS: Record<Change, string> = {
  existing: "Existing",
  new: "New",
  modified: "Changed",
  removed: "Removed",
  preserved: "Kept",
  renamed: "Renamed",
  split: "Split",
  relocated: "Moved",
};

export function IntentFieldInput({
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

export function cloneFieldValues(values: IntentRecord["values"]): IntentRecord["values"] {
  const clone: IntentRecord["values"] = {};
  for (const [key, value] of Object.entries(values)) {
    clone[key] = Array.isArray(value) ? [...value] : value;
  }
  return clone;
}

export function normalizeFieldValues(
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
