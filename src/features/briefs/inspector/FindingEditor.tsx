import { useState } from "react";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import type { Finding, FindingsSection, FindingUpdate } from "../model/index";
import { EditorForm, LabeledEditorField, sourcePlaceholder } from "./EditorForm";

export function FindingEditor({
  section,
  finding,
  onSave,
  onCancel,
}: {
  section: FindingsSection;
  finding: Finding;
  onSave: (update: FindingUpdate) => string | undefined;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    statement: finding.statement,
    whyItMatters: finding.whyItMatters ?? "",
    sources: finding.sources?.join("\n") ?? "",
  }));

  function save(current: typeof draft): string | undefined {
    const whyItMatters = current.whyItMatters.trim();
    const sources = current.sources
      .split("\n")
      .map((source) => source.trim())
      .filter(Boolean);
    return onSave({
      statement: current.statement.trim(),
      ...(whyItMatters ? { whyItMatters } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    });
  }

  return (
    <EditorForm current={finding} draft={draft} onSave={save} onCancel={onCancel}>
      <LabeledEditorField label="Finding">
        {(id) => (
          <Input
            id={id}
            value={draft.statement}
            onChange={(event) =>
              setDraft((current) => ({ ...current, statement: event.target.value }))
            }
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
            onChange={(event) =>
              setDraft((current) => ({ ...current, whyItMatters: event.target.value }))
            }
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
            onChange={(event) =>
              setDraft((current) => ({ ...current, sources: event.target.value }))
            }
            required={section.sourcePolicy !== "optional"}
            placeholder={sourcePlaceholder(section.sourcePolicy)}
            className="min-h-20 font-mono text-xs"
          />
        )}
      </LabeledEditorField>
    </EditorForm>
  );
}
