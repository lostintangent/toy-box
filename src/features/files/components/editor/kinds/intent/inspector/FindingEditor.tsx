import { useState, type FormEvent } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import type { Finding, FindingsSection, FindingUpdate } from "../model/index";
import { LabeledEditorField } from "./FieldEditor";

export function IntentFindingEditor({
  section,
  finding,
  onSave,
  onCancel,
}: {
  section: FindingsSection;
  finding: Finding;
  onSave: (update: FindingUpdate, original: Finding) => string | undefined;
  onCancel: () => void;
}) {
  const [original] = useState(finding);
  const [draft, setDraft] = useState(() => ({
    statement: finding.statement,
    whyItMatters: finding.whyItMatters ?? "",
    sources: finding.sources?.join("\n") ?? "",
  }));
  const [error, setError] = useState<string>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const whyItMatters = draft.whyItMatters.trim();
    const sources = draft.sources
      .split("\n")
      .map((source) => source.trim())
      .filter(Boolean);
    const update: FindingUpdate = {
      statement: draft.statement.trim(),
      ...(whyItMatters ? { whyItMatters } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    };
    setError(onSave(update, original));
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <LabeledEditorField label="Finding">
        {(id) => (
          <Input
            id={id}
            value={draft.statement}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, statement: event.target.value }));
            }}
            autoFocus
            required
          />
        )}
      </LabeledEditorField>

      <LabeledEditorField label="Why it matters" hint="Optional">
        {(id) => (
          <Textarea
            id={id}
            value={draft.whyItMatters}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, whyItMatters: event.target.value }));
            }}
            placeholder="Explain how this fact shapes the change."
          />
        )}
      </LabeledEditorField>

      <LabeledEditorField
        label="Sources"
        hint={section.sourcePolicy === "optional" ? "Optional · one per line" : "One per line"}
      >
        {(id) => (
          <Textarea
            id={id}
            value={draft.sources}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, sources: event.target.value }));
            }}
            required={section.sourcePolicy !== "optional"}
            placeholder={
              section.sourcePolicy === "code"
                ? "src/path/file.ts#Symbol"
                : "Code, document, issue, or other useful source"
            }
            className="min-h-20 font-mono text-xs"
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
