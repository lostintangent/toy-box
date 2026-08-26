import { useState, type FormEvent, type ReactNode } from "react";
import { Box, Boxes, File, Folder, Plus, Trash2 } from "lucide-react";
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
  type DomainTreeEntry,
  type FileTreeEntry,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type SourcePolicy,
  type TreeChange,
} from "../model/index";
import { CHANGE_EDITOR_LABELS, LabeledEditorField } from "./FieldEditor";

const TREE_CHANGE_LABEL: Record<TreeChange | "unchanged", string> = {
  unchanged: "No change",
  new: "Added",
  modified: "Modified",
  removed: "Deleted",
};

export function IntentExhibitEditor({
  sourcePolicy,
  allowExisting = true,
  exhibit,
  onSave,
  onCancel,
}: {
  sourcePolicy: SourcePolicy;
  allowExisting?: boolean;
  exhibit: IntentExhibit;
  onSave: (update: IntentExhibitUpdate, original: IntentExhibit) => string | undefined;
  onCancel: () => void;
}) {
  const [original] = useState(exhibit);
  const [draft, setDraft] = useState<IntentExhibitUpdate>(() => cloneExhibit(exhibit));
  const [error, setError] = useState<string>();
  const allowedChanges = allowExisting
    ? INTENT_CHANGES
    : INTENT_CHANGES.filter((change) => change !== "existing");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(onSave(normalizeExhibit(draft), original));
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <LabeledEditorField label="Title">
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

      <LabeledEditorField label="What this detail settles" hint="Optional">
        {(id) => (
          <Textarea
            id={id}
            value={draft.description ?? ""}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, description: event.target.value }));
            }}
            placeholder="Why this definition belongs in the intent."
          />
        )}
      </LabeledEditorField>

      {draft.kind === "pseudocode" ? (
        <PseudocodeFields
          language={draft.language}
          content={draft.content}
          onLanguageChange={(language) => {
            setError(undefined);
            setDraft((current) =>
              current.kind === "pseudocode" ? { ...current, language } : current,
            );
          }}
          onContentChange={(content) => {
            setError(undefined);
            setDraft((current) =>
              current.kind === "pseudocode" ? { ...current, content } : current,
            );
          }}
        />
      ) : draft.kind === "tree" && draft.type === "files" ? (
        <FileTreeFields
          roots={draft.roots}
          onChange={(roots) => {
            setError(undefined);
            setDraft((current) =>
              current.kind === "tree" && current.type === "files" ? { ...current, roots } : current,
            );
          }}
        />
      ) : draft.kind === "tree" ? (
        <DomainTreeFields
          roots={draft.roots}
          onChange={(roots) => {
            setError(undefined);
            setDraft((current) =>
              current.kind === "tree" && current.type === "domain"
                ? { ...current, roots }
                : current,
            );
          }}
        />
      ) : draft.kind === "flow" ? (
        <p className="rounded-lg border border-border/70 bg-muted/20 p-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
          Flow nodes, connections, paths, and regions are edited together by regenerating their
          owning definition. Direct edits preserve that authored structure.
        </p>
      ) : draft.kind === "html" && "content" in draft ? (
        <LabeledEditorField label="HTML content">
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
        </LabeledEditorField>
      ) : (
        <LabeledEditorField label={draft.kind === "image" ? "Image URI" : "HTML URI"}>
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
        </LabeledEditorField>
      )}

      {draft.kind === "image" && (
        <LabeledEditorField label="Alternative text">
          {(id) => (
            <Input
              id={id}
              value={draft.altText}
              onChange={(event) => {
                setError(undefined);
                setDraft((current) =>
                  current.kind === "image" ? { ...current, altText: event.target.value } : current,
                );
              }}
              placeholder="Describe the visual information this image conveys."
              required
            />
          )}
        </LabeledEditorField>
      )}

      <LabeledEditorField
        label="Source"
        hint={sourcePolicy === "optional" ? "Optional" : "Required unless new"}
      >
        {(id) => (
          <Input
            id={id}
            value={draft.source ?? ""}
            onChange={(event) => {
              setError(undefined);
              setDraft((current) => ({ ...current, source: event.target.value }));
            }}
            required={sourcePolicy !== "optional" && draft.change !== "new"}
            placeholder={
              sourcePolicy === "code"
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

function PseudocodeFields({
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
      <LabeledEditorField label="Language" hint="Optional">
        {(id) => (
          <Input
            id={id}
            value={language ?? ""}
            onChange={(event) => onLanguageChange(event.target.value)}
            placeholder="typescript, sql, bash, json..."
          />
        )}
      </LabeledEditorField>
      <LabeledEditorField label="Pseudocode or interface">
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
      </LabeledEditorField>
    </>
  );
}

/* oxlint-disable react/no-array-index-key -- Tree entries are controlled authored detail, not identity-bearing entities. */
function FileTreeFields({
  roots,
  onChange,
}: {
  roots: FileTreeEntry[];
  onChange: (roots: FileTreeEntry[]) => void;
}) {
  function addRoot(kind: FileTreeEntry["kind"]) {
    onChange([...roots, newFileTreeEntry(kind)]);
  }

  return (
    <fieldset className="space-y-2.5">
      <legend className="text-xs font-medium">File trees</legend>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Use separate roots when the target paths do not need a shared ancestor.
      </p>
      <div className="space-y-2">
        {roots.map((root, index) => (
          <FileTreeEntryFields
            key={index}
            entry={root}
            location={`Root ${index + 1}`}
            canRemove={roots.length > 1}
            onChange={(next) =>
              onChange(
                roots.map((candidate, candidateIndex) =>
                  candidateIndex === index ? next : candidate,
                ),
              )
            }
            onRemove={() => onChange(roots.filter((_, candidateIndex) => candidateIndex !== index))}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => addRoot("folder")}>
          <Folder className="size-3.5" />
          Add folder root
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addRoot("file")}>
          <File className="size-3.5" />
          Add file root
        </Button>
      </div>
    </fieldset>
  );
}

function FileTreeEntryFields({
  entry,
  location,
  canRemove,
  onChange,
  onRemove,
}: {
  entry: FileTreeEntry;
  location: string;
  canRemove: boolean;
  onChange: (entry: FileTreeEntry) => void;
  onRemove: () => void;
}) {
  const EntryIcon = entry.kind === "folder" ? Folder : File;

  function updateChild(index: number, child: FileTreeEntry) {
    if (entry.kind !== "folder") return;
    onChange({
      ...entry,
      children: entry.children.map((candidate, candidateIndex) =>
        candidateIndex === index ? child : candidate,
      ),
    });
  }

  function removeChild(index: number) {
    if (entry.kind !== "folder") return;
    onChange({
      ...entry,
      children: entry.children.filter((_, candidateIndex) => candidateIndex !== index),
    });
  }

  function addChild(kind: FileTreeEntry["kind"]) {
    if (entry.kind !== "folder") return;
    onChange({ ...entry, children: [...entry.children, newFileTreeEntry(kind)] });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/10 p-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <EntryIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          aria-label={`${location} ${entry.kind} name`}
          value={entry.name}
          onChange={(event) => onChange({ ...entry, name: event.target.value })}
          placeholder={entry.kind === "folder" ? "Folder name or root path" : "File name or path"}
          className="min-w-0 flex-1 font-mono text-xs"
          required
        />
        <TreeChangeSelect
          location={location}
          change={entry.change}
          onChange={(change) => onChange({ ...entry, change })}
        />
        <StepButton label={`Remove ${location}`} disabled={!canRemove} onClick={onRemove}>
          <Trash2 className="size-3" />
        </StepButton>
      </div>
      {entry.kind === "folder" && (
        <div className="ml-[0.4375rem] space-y-1.5 border-l border-border/70 pl-[0.8125rem]">
          {entry.children.map((child, index) => (
            <FileTreeEntryFields
              key={index}
              entry={child}
              location={`${location}, item ${index + 1}`}
              canRemove
              onChange={(next) => updateChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ))}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => addChild("folder")}>
              <Plus className="size-3" />
              Folder
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => addChild("file")}>
              <Plus className="size-3" />
              File
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DomainTreeFields({
  roots,
  onChange,
}: {
  roots: DomainTreeEntry[];
  onChange: (roots: DomainTreeEntry[]) => void;
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="text-xs font-medium">Domain trees</legend>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Use separate roots for independent conceptual hierarchies.
      </p>
      <div className="space-y-2">
        {roots.map((root, index) => (
          <DomainTreeEntryFields
            key={index}
            entry={root}
            location={`Root ${index + 1}`}
            canRemove={roots.length > 1}
            onChange={(next) =>
              onChange(
                roots.map((candidate, candidateIndex) =>
                  candidateIndex === index ? next : candidate,
                ),
              )
            }
            onRemove={() => onChange(roots.filter((_, candidateIndex) => candidateIndex !== index))}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...roots, newDomainTreeEntry()])}
      >
        <Boxes className="size-3.5" />
        Add domain root
      </Button>
    </fieldset>
  );
}

function DomainTreeEntryFields({
  entry,
  location,
  canRemove,
  onChange,
  onRemove,
}: {
  entry: DomainTreeEntry;
  location: string;
  canRemove: boolean;
  onChange: (entry: DomainTreeEntry) => void;
  onRemove: () => void;
}) {
  function updateChild(index: number, child: DomainTreeEntry) {
    onChange({
      ...entry,
      children: (entry.children ?? []).map((candidate, candidateIndex) =>
        candidateIndex === index ? child : candidate,
      ),
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/10 p-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Box className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          aria-label={`${location} domain name`}
          value={entry.name}
          onChange={(event) => onChange({ ...entry, name: event.target.value })}
          placeholder="Domain concept"
          className="min-w-0 flex-1 text-xs"
          required
        />
        <TreeChangeSelect
          location={location}
          change={entry.change}
          onChange={(change) => onChange({ ...entry, change })}
        />
        <StepButton label={`Remove ${location}`} disabled={!canRemove} onClick={onRemove}>
          <Trash2 className="size-3" />
        </StepButton>
      </div>
      <div className="ml-[0.4375rem] space-y-1.5 border-l border-border/70 pl-[0.8125rem]">
        {(entry.children ?? []).map((child, index) => (
          <DomainTreeEntryFields
            key={index}
            entry={child}
            location={`${location}, item ${index + 1}`}
            canRemove
            onChange={(next) => updateChild(index, next)}
            onRemove={() =>
              onChange({
                ...entry,
                children: entry.children?.filter((_, candidateIndex) => candidateIndex !== index),
              })
            }
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              ...entry,
              children: [...(entry.children ?? []), newDomainTreeEntry()],
            })
          }
        >
          <Plus className="size-3" />
          Concept
        </Button>
      </div>
    </div>
  );
}

function TreeChangeSelect({
  location,
  change,
  onChange,
}: {
  location: string;
  change?: TreeChange;
  onChange: (change: TreeChange | undefined) => void;
}) {
  return (
    <Select
      value={change ?? "unchanged"}
      onValueChange={(next: TreeChange | "unchanged") =>
        onChange(next === "unchanged" ? undefined : next)
      }
    >
      <SelectTrigger aria-label={`${location} change`} className="w-28 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(TREE_CHANGE_LABEL).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
/* oxlint-enable react/no-array-index-key */

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

function cloneExhibit(exhibit: IntentExhibit): IntentExhibitUpdate {
  const { id: _id, basedOn: _basedOn, ...update } = exhibit;
  if (update.kind === "tree") {
    return update.type === "files"
      ? { ...update, roots: update.roots.map(cloneFileTreeEntry) }
      : { ...update, roots: update.roots.map(cloneDomainTreeEntry) };
  }
  return { ...update };
}

function normalizeExhibit(draft: IntentExhibitUpdate): IntentExhibitUpdate {
  const title = draft.title.trim();
  const description = draft.description?.trim();
  const source = draft.source?.trim();
  const common = {
    title,
    change: draft.change,
    ...(description ? { description } : {}),
    ...(source ? { source } : {}),
  };
  if (draft.kind === "pseudocode") {
    const language = draft.language?.trim();
    return {
      ...common,
      kind: "pseudocode",
      ...(language ? { language } : {}),
      content: draft.content,
    };
  }
  if (draft.kind === "image") {
    return {
      ...common,
      kind: "image",
      uri: draft.uri.trim(),
      altText: draft.altText.trim(),
    };
  }
  if (draft.kind === "tree") {
    return draft.type === "files"
      ? {
          ...common,
          kind: "tree",
          type: "files",
          roots: draft.roots.map(normalizeFileTreeEntry),
        }
      : {
          ...common,
          kind: "tree",
          type: "domain",
          roots: draft.roots.map(normalizeDomainTreeEntry),
        };
  }
  if (draft.kind === "flow") {
    return {
      ...common,
      kind: "flow",
      nodes: draft.nodes,
      connections: draft.connections,
      paths: draft.paths,
      ...(draft.regions ? { regions: draft.regions } : {}),
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
  return draft;
}

function newFileTreeEntry(kind: FileTreeEntry["kind"]): FileTreeEntry {
  return kind === "folder"
    ? { kind: "folder", name: "", children: [] }
    : { kind: "file", name: "" };
}

function newDomainTreeEntry(): DomainTreeEntry {
  return { name: "" };
}

function cloneFileTreeEntry(entry: FileTreeEntry): FileTreeEntry {
  return entry.kind === "folder"
    ? { ...entry, children: entry.children.map(cloneFileTreeEntry) }
    : { ...entry };
}

function cloneDomainTreeEntry(entry: DomainTreeEntry): DomainTreeEntry {
  return {
    ...entry,
    ...(entry.children ? { children: entry.children.map(cloneDomainTreeEntry) } : {}),
  };
}

function normalizeFileTreeEntry(entry: FileTreeEntry): FileTreeEntry {
  const common = {
    name: entry.name.trim(),
    ...(entry.change ? { change: entry.change } : {}),
  };
  return entry.kind === "folder"
    ? {
        ...common,
        kind: "folder",
        children: entry.children.map(normalizeFileTreeEntry),
      }
    : { ...common, kind: "file" };
}

function normalizeDomainTreeEntry(entry: DomainTreeEntry): DomainTreeEntry {
  const children = entry.children?.map(normalizeDomainTreeEntry);
  return {
    name: entry.name.trim(),
    ...(entry.change ? { change: entry.change } : {}),
    ...(children?.length ? { children } : {}),
  };
}
