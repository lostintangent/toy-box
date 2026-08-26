import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { LayoutGrid, Table2, X } from "lucide-react";
import { cn } from "@/shared/utils";
import {
  fieldValueText,
  projectedRecords,
  recordLabel,
  recordReadingFields,
  type IntentDocument,
  type IntentEntityId,
  type IntentField,
  type ProjectedRecord,
  type RecordsSection,
  type RecordsView,
} from "../../model/index";
import { ChangeTag, SectionViewControl, Tag } from "../shared";

const CHOICE_CLASSES = [
  "bg-sky-500/10 text-sky-400",
  "bg-violet-500/10 text-violet-400",
  "bg-emerald-500/10 text-emerald-400",
  "bg-amber-500/10 text-amber-400",
  "bg-cyan-500/10 text-cyan-400",
  "bg-rose-500/10 text-rose-400",
] as const;

const RECORD_VIEW_OPTIONS = [
  { value: "table", description: "a table", title: "Table view", Icon: Table2 },
  { value: "cards", description: "cards", title: "Cards view", Icon: LayoutGrid },
] as const;

function choiceClass(fieldId: string, optionId: string): string {
  let hash = 0;
  for (const character of `${fieldId}:${optionId}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CHOICE_CLASSES[hash % CHOICE_CLASSES.length]!;
}

type ChoiceField = Extract<IntentField, { kind: "choice" }>;

function ChoiceTag({ field, optionId }: { field: ChoiceField; optionId: string }) {
  const option = field.options.find((candidate) => candidate.id === optionId);
  const description = option?.description;
  return (
    <Tag
      title={description}
      ariaLabel={description ? `${option.label}: ${description}` : undefined}
      className={choiceClass(field.id, optionId)}
    >
      {option?.label ?? optionId}
    </Tag>
  );
}

function FieldValue({ field, value }: { field: IntentField; value: string | string[] }) {
  if (field.kind === "text") {
    return <span>{fieldValueText(field, value)}</span>;
  }

  const optionIds = Array.isArray(value) ? value : [value];
  return (
    <div className="flex flex-wrap gap-1">
      {optionIds.map((optionId) => (
        <ChoiceTag key={optionId} field={field} optionId={optionId} />
      ))}
    </div>
  );
}

function ChoiceLegends({ fields }: { fields: IntentField[] }) {
  const choices = fields.filter(
    (field): field is Extract<IntentField, { kind: "choice" }> =>
      field.kind === "choice" && field.options.some((option) => Boolean(option.description)),
  );
  if (choices.length === 0) return null;

  return (
    <details className="mt-2.5 text-[10px] text-muted-foreground">
      <summary className="cursor-pointer font-medium hover:text-foreground">
        What these labels mean
      </summary>
      <div className="mt-1.5 space-y-1">
        {choices.map((field) => (
          <div key={field.id} className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 font-medium">{field.label}:</span>
            {field.options.map((option) => (
              <ChoiceTag key={option.id} field={field} optionId={option.id} />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function RemoveRecordButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground"
    >
      <X aria-hidden className="size-3" />
    </button>
  );
}

function RecordMeta({
  entry,
  onRemove,
}: {
  entry: ProjectedRecord;
  onRemove?: (recordId: string) => void;
}) {
  const selected = entry.selected;
  const selectedLabel = selected?.status === "decided" ? "Decided" : "Trying";
  const removable = !selected && entry.item.change === "new" && onRemove;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        <ChangeTag change={entry.item.change} source={entry.item.source} />
        {selected && (
          <Tag
            className={
              selected.status === "decided"
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-amber-500/10 text-amber-400"
            }
            ariaLabel={`${selectedLabel} addition from option ${selected.optionLabel}`}
          >
            {selectedLabel}
          </Tag>
        )}
        {removable && (
          <RemoveRecordButton
            label={`Remove ${recordLabel(entry.item)} from intent`}
            onClick={() => onRemove(entry.item.id)}
          />
        )}
      </div>
      {selected && (
        <div className="mt-1 text-[9.5px] text-violet-400/80">{selected.optionLabel}</div>
      )}
    </div>
  );
}

const NESTED_RECORD_CONTROL = "button, a, input, select, textarea, [role='button'], [tabindex]";

function targetsNestedRecordControl(
  event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest(NESTED_RECORD_CONTROL);
  return control !== null && control !== event.currentTarget;
}

function inspectRecordFromClick(
  event: ReactMouseEvent<HTMLElement>,
  recordId: string,
  onInspect?: (entityId: IntentEntityId) => void,
): void {
  if (!onInspect || targetsNestedRecordControl(event)) return;
  onInspect(recordId);
}

function inspectRecordFromKeyboard(
  event: ReactKeyboardEvent<HTMLElement>,
  recordId: string,
  onInspect?: (entityId: IntentEntityId) => void,
): void {
  if (
    !onInspect ||
    event.target !== event.currentTarget ||
    (event.key !== "Enter" && event.key !== " ")
  ) {
    return;
  }
  event.preventDefault();
  onInspect(recordId);
}

type RecordsProjectionProps = {
  section: RecordsSection;
  entries: ProjectedRecord[];
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
  onRemove?: (recordId: string) => void;
};

function RecordsTable({
  section,
  entries,
  focusedEntityId,
  onInspect,
  onRemove,
}: RecordsProjectionProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-[10.5px] text-muted-foreground/70">
            {section.subject && <th className="pb-1.5 pr-3 font-medium">{section.subject}</th>}
            {section.fields.map((field) => (
              <th key={field.id} className="pb-1.5 pr-3 font-medium">
                {field.label}
              </th>
            ))}
            {!section.subject && <th className="pb-1.5 pr-3 font-medium">About this</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const focused = focusedEntityId === entry.item.id;
            return (
              <tr
                key={entry.item.id}
                tabIndex={onInspect ? 0 : undefined}
                aria-label={onInspect ? `Inspect ${recordLabel(entry.item)}` : undefined}
                aria-current={focused || undefined}
                onClick={(event) => inspectRecordFromClick(event, entry.item.id, onInspect)}
                onKeyDown={(event) => inspectRecordFromKeyboard(event, entry.item.id, onInspect)}
                className={cn(
                  "border-b border-border/50 text-[11px]",
                  onInspect &&
                    "cursor-pointer transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  entry.selected && "bg-violet-500/5",
                  focused && "bg-sky-500/10 outline outline-1 outline-sky-400/60",
                )}
                data-focused={focused || undefined}
              >
                {section.subject && (
                  <td className="py-2 pr-3 align-top">
                    <div className="text-[11.5px] font-medium leading-snug">
                      {entry.item.subject}
                    </div>
                    <div className="mt-1.5">
                      <RecordMeta entry={entry} onRemove={onRemove} />
                    </div>
                  </td>
                )}
                {section.fields.map((field) => (
                  <td key={field.id} className="py-2 pr-3 align-top">
                    <FieldValue field={field} value={entry.item.values[field.id]} />
                  </td>
                ))}
                {!section.subject && (
                  <td className="py-2 pr-3 align-top">
                    <RecordMeta entry={entry} onRemove={onRemove} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecordsCards({
  section,
  entries,
  focusedEntityId,
  onInspect,
  onRemove,
}: RecordsProjectionProps) {
  const { bodyField, summaryChoiceField } = recordReadingFields(section);

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => {
        const focused = focusedEntityId === entry.item.id;
        return (
          <article
            key={entry.item.id}
            tabIndex={onInspect ? 0 : undefined}
            aria-label={onInspect ? `Inspect ${recordLabel(entry.item)}` : undefined}
            aria-current={focused || undefined}
            onClick={(event) => inspectRecordFromClick(event, entry.item.id, onInspect)}
            onKeyDown={(event) => inspectRecordFromKeyboard(event, entry.item.id, onInspect)}
            className={cn(
              "rounded-lg border border-border/60 bg-muted/15 p-2.5",
              onInspect &&
                "cursor-pointer transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              entry.selected && "border-violet-500/30 bg-violet-500/5",
              focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
            )}
            data-focused={focused || undefined}
          >
            <div className="flex items-start gap-2">
              {section.subject && (
                <div className="min-w-0 flex-1 text-[12px] font-semibold leading-snug">
                  {entry.item.subject}
                </div>
              )}
              {summaryChoiceField && (
                <div className="shrink-0 pt-0.5">
                  <span className="sr-only">{summaryChoiceField.label}: </span>
                  <FieldValue
                    field={summaryChoiceField}
                    value={entry.item.values[summaryChoiceField.id]}
                  />
                </div>
              )}
              <RecordMeta entry={entry} onRemove={onRemove} />
            </div>
            {bodyField ? (
              <p className="mt-2 text-[11px] leading-relaxed text-foreground/90">
                <FieldValue field={bodyField} value={entry.item.values[bodyField.id]} />
              </p>
            ) : (
              section.fields.length > 0 && (
                <dl className="mt-2 space-y-1.5 text-[10.5px]">
                  {section.fields.map((field) => (
                    <div key={field.id}>
                      <dt className="text-[10px] font-medium text-muted-foreground/70">
                        {field.label}
                      </dt>
                      <dd className="mt-0.5 text-foreground/90">
                        <FieldValue field={field} value={entry.item.values[field.id]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )
            )}
          </article>
        );
      })}
    </div>
  );
}

export function IntentRecordsContent({
  document,
  section,
  view,
  focusedEntityId,
  onInspect,
  onRemoveRecord,
  onViewChange,
}: {
  document: IntentDocument;
  section: RecordsSection;
  view: RecordsView;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
  onRemoveRecord?: (sectionId: string, recordId: string) => void;
  onViewChange: (view: RecordsView) => void;
}) {
  const entries = projectedRecords(document, section.id);
  const remove = onRemoveRecord
    ? (recordId: string) => onRemoveRecord(section.id, recordId)
    : undefined;

  return (
    <div>
      <SectionViewControl
        title={section.title}
        view={view}
        options={RECORD_VIEW_OPTIONS}
        className="mb-2"
        onViewChange={onViewChange}
      />
      {entries.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">No records mapped yet.</p>
      ) : view === "table" ? (
        <RecordsTable
          section={section}
          entries={entries}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
          onRemove={remove}
        />
      ) : (
        <RecordsCards
          section={section}
          entries={entries}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
          onRemove={remove}
        />
      )}
      <ChoiceLegends fields={section.fields} />
    </div>
  );
}
