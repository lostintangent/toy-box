import { useState, type ReactNode } from "react";
import { BookOpenText, FileCode2, GitFork, Pencil } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import {
  effectiveRelations,
  fieldValueText,
  intentEntities,
  recordDecisionOrigin,
  type Decision,
  type IntentDefinition,
  type IntentEntity,
  type IntentEntityId,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type IntentField,
  type IntentRecord,
  type IntentRecordUpdate,
  type OptionAddition,
  type WorkItem,
  type WorkItemUpdate,
} from "./model/index";
import { IntentExhibitEditor } from "./ExhibitEditor";
import { IntentRecordEditor, IntentWorkEditor } from "./RecordEditor";
import { IntentExhibitCard } from "./sections";
import { ChangeTag, decisionStatusLabel, intentRelationLabel } from "./sections/shared";

type UpdateRecord = (
  recordId: string,
  update: IntentRecordUpdate,
  original: IntentRecord | OptionAddition,
) => string | undefined;

type UpdateWork = (
  itemId: string,
  update: WorkItemUpdate,
  original: WorkItem,
) => string | undefined;

type UpdateExhibit = (
  exhibitId: string,
  update: IntentExhibitUpdate,
  original: IntentExhibit,
) => string | undefined;

type InspectorProps = {
  definition: IntentDefinition;
  baseUri?: string;
  entity?: IntentEntity;
  pending: ReadonlySet<string>;
  onClose: () => void;
  onExplain?: (itemId: string) => void;
  onInspect: (entityId: IntentEntityId) => void;
  onUpdateRecord?: UpdateRecord;
  onUpdateWork?: UpdateWork;
  onUpdateExhibit?: UpdateExhibit;
};

export function IntentEntityInspector({
  definition,
  baseUri,
  entity,
  pending,
  onClose,
  onExplain,
  onInspect,
  onUpdateRecord,
  onUpdateWork,
  onUpdateExhibit,
}: InspectorProps) {
  return (
    <Sheet open={Boolean(entity)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[92%] gap-0 overflow-hidden p-0 sm:max-w-sm">
        {entity && (
          <InspectorContent
            key={entity.id}
            definition={definition}
            baseUri={baseUri}
            entity={entity}
            pending={pending}
            onExplain={onExplain}
            onInspect={onInspect}
            onUpdateRecord={onUpdateRecord}
            onUpdateWork={onUpdateWork}
            onUpdateExhibit={onUpdateExhibit}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function InspectorContent({
  definition,
  baseUri,
  entity,
  pending,
  onExplain,
  onInspect,
  onUpdateRecord,
  onUpdateWork,
  onUpdateExhibit,
}: Omit<InspectorProps, "entity" | "onClose"> & { entity: IntentEntity }) {
  const [editing, setEditing] = useState(false);
  const entities = new Map(intentEntities(definition).map((item) => [item.id, item]));
  const relations = effectiveRelations(definition).filter(
    ({ relation }) => relation.from === entity.id || relation.to === entity.id,
  );
  const affected =
    entity.type === "question"
      ? entity.question.affects
      : entity.type === "decision"
        ? entity.decision.affects
        : [];

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle>{entity.label}</SheetTitle>
        <SheetDescription>{entityTypeLabel(entity)}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {entity.type === "record" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <ChangeTag change={entity.change} />
            <span className="text-[10.5px] text-muted-foreground">{entity.section.title}</span>
          </div>
        )}
        {(entity.type === "section" || entity.type === "question" || entity.type === "decision") &&
          entity.detail && (
            <p className="text-[12px] leading-relaxed text-foreground/90">{entity.detail}</p>
          )}
        <EntityDetails
          definition={definition}
          baseUri={baseUri}
          entity={entity}
          editing={editing}
          pending={pending}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onExplain={onExplain}
          onInspect={onInspect}
          onUpdateRecord={onUpdateRecord}
          onUpdateWork={onUpdateWork}
          onUpdateExhibit={onUpdateExhibit}
        />
        {!editing && affected.length > 0 && (
          <InspectorSection title="What this touches">
            <div className="space-y-2">
              {affected.map((entityId) => {
                const related = entities.get(entityId);
                if (!related) return null;
                return (
                  <InspectorLink
                    key={entityId}
                    label={related.label}
                    detail={entityTypeLabel(related)}
                    onClick={() => onInspect(entityId)}
                  />
                );
              })}
            </div>
          </InspectorSection>
        )}
        {!editing && relations.length > 0 && (
          <InspectorSection title="Connections" icon={<GitFork className="size-3" />}>
            <div className="space-y-2">
              {relations.map((effective) => {
                const outgoing = effective.relation.from === entity.id;
                const related = entities.get(
                  outgoing ? effective.relation.to : effective.relation.from,
                );
                if (!related) return null;
                const status = effective.optionLabel
                  ? ` · ${effective.optionLabel} (${decisionStatusLabel(effective.status)})`
                  : "";
                return (
                  <InspectorLink
                    key={effective.relation.id}
                    eyebrow={`${outgoing ? "→ " : "← "}${intentRelationLabel(effective.relation)}${status}`}
                    label={related.label}
                    onClick={() => onInspect(related.id)}
                  />
                );
              })}
            </div>
          </InspectorSection>
        )}
      </div>
    </>
  );
}

function EntityDetails({
  definition,
  baseUri,
  entity,
  editing,
  pending,
  onEdit,
  onDone,
  onExplain,
  onInspect,
  onUpdateRecord,
  onUpdateWork,
  onUpdateExhibit,
}: Omit<InspectorProps, "entity" | "onClose"> & {
  entity: IntentEntity;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  if (entity.type === "work") {
    if (editing && onUpdateWork) {
      return (
        <IntentWorkEditor
          section={entity.section}
          item={entity.work}
          onSave={(update, original) => {
            const error = onUpdateWork(entity.work.id, update, original);
            if (!error) onDone();
            return error;
          }}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        <FieldValues fields={entity.section.fields} values={entity.work.values} />
        {onUpdateWork && <EditButton onClick={onEdit} />}
      </>
    );
  }

  if (entity.type === "record") {
    if (editing && onUpdateRecord) {
      return (
        <IntentRecordEditor
          section={entity.section}
          record={entity.record}
          onSave={(update, original) => {
            const error = onUpdateRecord(entity.record.id, update, original);
            if (!error) onDone();
            return error;
          }}
          onCancel={onDone}
        />
      );
    }
    const origin = recordDecisionOrigin(definition, entity.record.id);
    return (
      <>
        <FieldValues fields={entity.section.fields} values={entity.record.values} />
        {entity.record.explanation && (
          <InspectorSection title="Explanation">
            <p>{entity.record.explanation}</p>
          </InspectorSection>
        )}
        {entity.provenance && (
          <InspectorSection title="Source" icon={<FileCode2 className="size-3" />}>
            <code className="break-all text-[10px]">{entity.provenance}</code>
          </InspectorSection>
        )}
        {origin && (
          <InspectorSection title="Came from">
            <InspectorLink
              label={origin.option.label}
              detail={`${origin.decision.question} · ${decisionStatusLabel(origin.status)}`}
              onClick={() => onInspect(origin.decision.id)}
            />
          </InspectorSection>
        )}
        {(onUpdateRecord || onExplain) && (
          <div className="flex flex-wrap gap-2">
            {onUpdateRecord && <EditButton onClick={onEdit} />}
            {onExplain && (
              <button
                type="button"
                disabled={pending.has(`explain-item:${entity.record.id}`)}
                onClick={() => onExplain(entity.record.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-medium hover:bg-muted disabled:opacity-40"
              >
                <BookOpenText className="size-3.5" />
                {pending.has(`explain-item:${entity.record.id}`)
                  ? "Explanation pending"
                  : entity.record.explanation
                    ? "Explain further"
                    : "Explain this"}
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  if (entity.type === "exhibit") {
    if (editing && onUpdateExhibit) {
      return (
        <IntentExhibitEditor
          section={entity.section}
          exhibit={entity.exhibit}
          onSave={(update, original) => {
            const error = onUpdateExhibit(entity.exhibit.id, update, original);
            if (!error) onDone();
            return error;
          }}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        <IntentExhibitCard exhibit={entity.exhibit} baseUri={baseUri} compact />
        {onUpdateExhibit && <EditButton onClick={onEdit} />}
      </>
    );
  }

  if (entity.type === "question" && entity.question.resolution) {
    return (
      <InspectorSection title="Resolution">
        <p>{entity.question.resolution}</p>
      </InspectorSection>
    );
  }

  if (entity.type === "decision") {
    return (
      <InspectorSection title="Where this choice stands">
        <DecisionState decision={entity.decision} />
      </InspectorSection>
    );
  }

  return null;
}

function FieldValues({
  fields,
  values,
}: {
  fields: IntentField[];
  values: Record<string, string | string[]>;
}) {
  if (fields.length === 0) return null;
  return (
    <dl className="space-y-2">
      {fields.map((field) => (
        <div key={field.id}>
          <dt className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            {field.label}
          </dt>
          <dd className="mt-0.5 text-[11.5px]">{fieldValueText(field, values[field.id])}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-medium hover:bg-muted"
    >
      <Pencil className="size-3.5" />
      Edit
    </button>
  );
}

function InspectorLink({
  eyebrow,
  label,
  detail,
  onClick,
}: {
  eyebrow?: string;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-md border border-border/60 p-2 text-left hover:bg-muted"
    >
      {eyebrow && <span className="text-[9.5px] font-medium text-sky-400">{eyebrow}</span>}
      <span className={eyebrow ? "mt-0.5 block text-[10.5px]" : "text-[10.5px] font-medium"}>
        {label}
      </span>
      {detail && <span className="mt-0.5 block text-[9.5px]">{detail}</span>}
    </button>
  );
}

function InspectorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="text-[11.5px] text-muted-foreground">
      <h3 className="mb-1 flex items-center gap-1 text-[10px] font-medium text-foreground/70">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function DecisionState({ decision }: { decision: Decision }) {
  const option = decision.options.find((candidate) => candidate.id === decision.chosen);
  return (
    <div className="space-y-1">
      <p>{decisionStatusLabel(decision.status)}</p>
      {option && (
        <>
          <p className="font-medium text-foreground">{option.label}</p>
          {option.rationale && <p>{option.rationale}</p>}
          {option.tradeoff && <p>Tradeoff: {option.tradeoff}</p>}
        </>
      )}
    </div>
  );
}

const EXHIBIT_KIND_LABEL: Record<IntentExhibit["kind"], string> = {
  code: "Code",
  procedure: "Steps",
  image: "Image",
  html: "HTML",
};

function entityTypeLabel(entity: IntentEntity): string {
  switch (entity.type) {
    case "work":
      return entity.stage
        ? `${entity.section.title} · ${entity.stage.title}`
        : entity.section.title;
    case "record":
      return entity.section.title;
    case "exhibit":
      return `${entity.section.title} · ${EXHIBIT_KIND_LABEL[entity.exhibit.kind]}`;
    case "section":
      return "Section";
    case "question":
      return "Question to answer";
    case "decision":
      return "Choice to make";
  }
}
