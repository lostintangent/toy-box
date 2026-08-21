import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Code2, Plus, Trash2 } from "lucide-react";
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
  type ExhibitsSection,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type ProcedureStep,
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

export function IntentExhibitEditor({
  section,
  exhibit,
  onSave,
  onCancel,
}: {
  section: ExhibitsSection;
  exhibit: IntentExhibit;
  onSave: (update: IntentExhibitUpdate, original: IntentExhibit) => string | undefined;
  onCancel: () => void;
}) {
  const [original] = useState(exhibit);
  const [draft, setDraft] = useState<IntentExhibitUpdate>(() => cloneExhibit(exhibit));
  const [error, setError] = useState<string>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(onSave(normalizeExhibit(draft), original));
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <ExhibitField label="Title">
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
      </ExhibitField>

      <ExhibitField label="Change">
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
              {INTENT_CHANGES.map((change) => (
                <SelectItem key={change} value={change}>
                  {CHANGE_LABEL[change]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </ExhibitField>

      <ExhibitField label="What this detail settles" hint="Optional">
        {(id) => (
          <Textarea
            id={id}
            value={draft.description ?? ""}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, description: event.target.value }));
            }}
            placeholder="Why this exact detail belongs in the intent."
          />
        )}
      </ExhibitField>

      {draft.kind === "code" ? (
        <CodeFields
          language={draft.language}
          content={draft.content}
          onLanguageChange={(language) => {
            setError(undefined);
            setDraft((current) => (current.kind === "code" ? { ...current, language } : current));
          }}
          onContentChange={(content) => {
            setError(undefined);
            setDraft((current) => (current.kind === "code" ? { ...current, content } : current));
          }}
        />
      ) : draft.kind === "procedure" ? (
        <ProcedureFields
          steps={draft.steps}
          onChange={(steps) => {
            setError(undefined);
            setDraft((current) => (current.kind === "procedure" ? { ...current, steps } : current));
          }}
        />
      ) : draft.kind === "html" && "content" in draft ? (
        <ExhibitField label="HTML content">
          {(id) => (
            <Textarea
              id={id}
              value={draft.content}
              onChange={(event) => {
                setError(undefined);
                setDraft((current) =>
                  current.kind === "html" && "content" in current
                    ? { ...current, content: event.target.value }
                    : current,
                );
              }}
              placeholder="<html>...</html> or <svg>...</svg>"
              className="min-h-56 font-mono text-xs"
              spellCheck={false}
              required
            />
          )}
        </ExhibitField>
      ) : (
        <ExhibitField label={draft.kind === "image" ? "Image URI" : "HTML URI"}>
          {(id) => (
            <Input
              id={id}
              value={draft.uri}
              onChange={(event) => {
                setError(undefined);
                setDraft((current) =>
                  current.kind === "image" || (current.kind === "html" && "uri" in current)
                    ? { ...current, uri: event.target.value }
                    : current,
                );
              }}
              placeholder={
                draft.kind === "image"
                  ? "./diagram.svg or https://example.com/diagram.png"
                  : "./prototype.html or https://example.com/prototype"
              }
              required
            />
          )}
        </ExhibitField>
      )}

      <ExhibitField
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
      </ExhibitField>

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

function CodeFields({
  language,
  content,
  onLanguageChange,
  onContentChange,
}: {
  language?: string;
  content: string;
  onLanguageChange: (language: string) => void;
  onContentChange: (content: string) => void;
}) {
  return (
    <>
      <ExhibitField label="Language" hint="Optional">
        {(id) => (
          <Input
            id={id}
            value={language ?? ""}
            onChange={(event) => onLanguageChange(event.target.value)}
            placeholder="typescript, sql, bash, json..."
          />
        )}
      </ExhibitField>
      <ExhibitField label="Exact content">
        {(id) => (
          <Textarea
            id={id}
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
            className="min-h-56 font-mono text-xs"
            spellCheck={false}
            required
          />
        )}
      </ExhibitField>
    </>
  );
}

function ProcedureFields({
  steps,
  onChange,
}: {
  steps: ProcedureStep[];
  onChange: (steps: ProcedureStep[]) => void;
}) {
  function updateStep(stepId: string, transition: (step: ProcedureStep) => ProcedureStep) {
    onChange(steps.map((step) => (step.id === stepId ? transition(step) : step)));
  }

  function moveStep(stepId: string, offset: -1 | 1) {
    const currentIndex = steps.findIndex((step) => step.id === stepId);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= steps.length) return;
    const next = [...steps];
    const [step] = next.splice(currentIndex, 1);
    if (!step) return;
    next.splice(targetIndex, 0, step);
    onChange(next);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium">Ordered steps</legend>
      {steps.map((step, index) => (
        <div key={step.id} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground">
              Step {index + 1}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <StepButton
                label={`Move step ${index + 1} up`}
                disabled={index === 0}
                onClick={() => moveStep(step.id, -1)}
              >
                <ArrowUp className="size-3" />
              </StepButton>
              <StepButton
                label={`Move step ${index + 1} down`}
                disabled={index === steps.length - 1}
                onClick={() => moveStep(step.id, 1)}
              >
                <ArrowDown className="size-3" />
              </StepButton>
              <StepButton
                label={`Remove step ${index + 1}`}
                disabled={steps.length === 1}
                onClick={() => onChange(steps.filter((candidate) => candidate.id !== step.id))}
              >
                <Trash2 className="size-3" />
              </StepButton>
            </div>
          </div>
          <Textarea
            aria-label={`Step ${index + 1} instruction`}
            value={step.instruction}
            onChange={(event) =>
              updateStep(step.id, (current) => ({
                ...current,
                instruction: event.target.value,
              }))
            }
            className="min-h-20"
            required
          />
          {step.code ? (
            <div className="space-y-2 border-l border-border pl-2.5">
              <div className="flex items-center gap-2">
                <Code2 className="size-3 text-sky-400" />
                <span className="text-[10px] font-medium">Exact code or command</span>
                <button
                  type="button"
                  onClick={() => updateStep(step.id, ({ code: _code, ...current }) => current)}
                  className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Remove code
                </button>
              </div>
              <Input
                aria-label={`Step ${index + 1} language`}
                value={step.code.language ?? ""}
                onChange={(event) =>
                  updateStep(step.id, (current) => ({
                    ...current,
                    code: {
                      ...current.code!,
                      language: event.target.value,
                    },
                  }))
                }
                placeholder="bash, sql, json..."
              />
              <Textarea
                aria-label={`Step ${index + 1} exact code`}
                value={step.code.content}
                onChange={(event) =>
                  updateStep(step.id, (current) => ({
                    ...current,
                    code: {
                      ...current.code!,
                      content: event.target.value,
                    },
                  }))
                }
                className="min-h-28 font-mono text-xs"
                spellCheck={false}
                required
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                updateStep(step.id, (current) => ({
                  ...current,
                  code: { content: "" },
                }))
              }
              className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-400 hover:text-sky-300"
            >
              <Code2 className="size-3" />
              Add exact code or command
            </button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...steps,
            {
              id: nextStepId(steps),
              instruction: "Describe the next step.",
            },
          ])
        }
      >
        <Plus className="size-3.5" />
        Add step
      </Button>
    </fieldset>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ExhibitField({
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

function cloneExhibit(exhibit: IntentExhibit): IntentExhibitUpdate {
  const { id: _id, ...update } = exhibit;
  if (update.kind !== "procedure") return { ...update };
  return {
    ...update,
    steps: update.steps.map((step) => ({
      ...step,
      ...(step.code ? { code: { ...step.code } } : {}),
    })),
  };
}

function normalizeExhibit(draft: IntentExhibitUpdate): IntentExhibitUpdate {
  const title = draft.title.trim();
  const description = draft.description?.trim();
  const provenance = draft.provenance?.trim();
  const common = {
    title,
    change: draft.change,
    ...(description ? { description } : {}),
    ...(provenance ? { provenance } : {}),
  };
  if (draft.kind === "code") {
    const language = draft.language?.trim();
    return {
      ...common,
      kind: "code",
      ...(language ? { language } : {}),
      content: draft.content,
    };
  }
  if (draft.kind === "image") {
    return {
      ...common,
      kind: "image",
      uri: draft.uri.trim(),
    };
  }
  if (draft.kind === "html") {
    return "uri" in draft
      ? {
          ...common,
          kind: "html",
          uri: draft.uri.trim(),
        }
      : {
          ...common,
          kind: "html",
          content: draft.content,
        };
  }
  return {
    ...common,
    kind: "procedure",
    steps: draft.steps.map((step) => {
      const language = step.code?.language?.trim();
      return {
        id: step.id,
        instruction: step.instruction.trim(),
        ...(step.code
          ? {
              code: {
                ...(language ? { language } : {}),
                content: step.code.content,
              },
            }
          : {}),
      };
    }),
  };
}

function nextStepId(steps: readonly ProcedureStep[]): string {
  const ids = new Set(steps.map((step) => step.id));
  let index = steps.length + 1;
  while (ids.has(`step-${index}`)) index += 1;
  return `step-${index}`;
}
