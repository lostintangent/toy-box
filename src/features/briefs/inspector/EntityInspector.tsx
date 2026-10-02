import { useState, type ReactNode } from "react";
import { code } from "@streamdown/code";
import { BookOpenText, FileCode2, GitFork, Pencil, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Markdown } from "@/shared/ui/markdown";
import {
  activeOption,
  canRemoveEntity,
  decisionStatus,
  entityLinks,
  updateExhibit,
  updateFinding,
  updatePlanStep,
  updateRecord,
  type BriefEdit,
  type Decision,
  type BriefDocument,
  type BriefEntity,
  type BriefEntityId,
  type BriefField,
  type EntityLinks,
} from "../model/index";
import { briefActionKey } from "../actions";
import { ExhibitEditor } from "./ExhibitEditor";
import { FindingEditor } from "./FindingEditor";
import { PlanStepEditor } from "./PlanStepEditor";
import { RecordEditor } from "./RecordEditor";
import { ExhibitCard, exhibitKindLabel } from "../sections/ExhibitsContent";
import {
  ChangeTag,
  DECISION_STATUS_PRESENTATION,
  FieldValueText,
  optionRelationshipLabel,
} from "../sections/vocabulary";

type InspectorProps = {
  document: BriefDocument;
  baseUri?: string;
  entity?: BriefEntity;
  pending: ReadonlySet<string>;
  onClose: () => void;
  onExplainRecord?: (recordId: string) => void;
  onInspect: (entityId: BriefEntityId) => void;
  /** Apply one content edit, returning why it could not be saved. */
  onSave?: (edit: BriefEdit) => string | undefined;
  onRemove?: (entityId: BriefEntityId) => void;
};

export function EntityInspector({
  document,
  baseUri,
  entity,
  pending,
  onClose,
  onExplainRecord,
  onInspect,
  onSave,
  onRemove,
}: InspectorProps) {
  return (
    <Sheet open={Boolean(entity)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[92%] gap-0 overflow-hidden p-0 sm:max-w-sm">
        {entity && (
          <InspectorContent
            key={entity.id}
            document={document}
            baseUri={baseUri}
            entity={entity}
            pending={pending}
            onExplainRecord={onExplainRecord}
            onInspect={onInspect}
            onSave={onSave}
            onRemove={onRemove}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function InspectorContent({
  document,
  baseUri,
  entity,
  pending,
  onExplainRecord,
  onInspect,
  onSave,
  onRemove,
}: Omit<InspectorProps, "entity" | "onClose"> & { entity: BriefEntity }) {
  const [editing, setEditing] = useState(false);
  const links = entityLinks(document, entity.id);

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
          document={document}
          baseUri={baseUri}
          entity={entity}
          origin={links.origin}
          editing={editing}
          pending={pending}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onExplainRecord={onExplainRecord}
          onInspect={onInspect}
          onSave={onSave}
          onRemove={onRemove}
        />
        {!editing && <EntityLinkList links={links} onInspect={onInspect} />}
      </div>
    </>
  );
}

function EntityLinkList({
  links,
  onInspect,
}: {
  links: EntityLinks;
  onInspect: (entityId: BriefEntityId) => void;
}) {
  return (
    <>
      <LinkedEntities title="Based on" entities={links.basedOn} onInspect={onInspect} />
      <LinkedEntities title="Grounds" entities={links.grounds} onInspect={onInspect} />
      <LinkedEntities title="What this touches" entities={links.affects} onInspect={onInspect} />
      <LinkedEntities title="Touched by" entities={links.affectedBy} onInspect={onInspect} />
      <LinkedEntities title="Implements" entities={links.implements} onInspect={onInspect} />
      <LinkedEntities title="Plan steps" entities={links.implementedBy} onInspect={onInspect} />
      {links.flows.length > 0 && (
        <InspectorSection title="Flows" icon={<GitFork className="size-3" />}>
          <div className="space-y-2">
            {links.flows.map(({ flow, connection, outgoing, related }) => (
              <InspectorLink
                key={`${flow.id}:${connection.id}:${outgoing ? "out" : "in"}`}
                eyebrow={`${outgoing ? "→ " : "← "}${connection.label} · ${flow.title}`}
                label={related.label}
                detail={related.entity ? entityTypeLabel(related.entity) : "Flow node"}
                onClick={() => onInspect(related.entity?.id ?? flow.id)}
              />
            ))}
          </div>
        </InspectorSection>
      )}
      {links.activeRelationships.length > 0 && (
        <InspectorSection title="Option relationships" icon={<GitFork className="size-3" />}>
          <div className="space-y-2">
            {links.activeRelationships.map(({ relationship, outgoing, related, activeOption }) => (
              <InspectorLink
                key={relationship.id}
                eyebrow={`${outgoing ? "→ " : "← "}${optionRelationshipLabel(relationship)} · ${activeOption.option.label} (${DECISION_STATUS_PRESENTATION[activeOption.status].label})`}
                label={related.label}
                onClick={() => onInspect(related.id)}
              />
            ))}
          </div>
        </InspectorSection>
      )}
    </>
  );
}

function LinkedEntities({
  title,
  entities,
  onInspect,
}: {
  title: string;
  entities: BriefEntity[];
  onInspect: (entityId: BriefEntityId) => void;
}) {
  if (entities.length === 0) return null;
  return (
    <InspectorSection title={title}>
      <div className="space-y-2">
        {entities.map((related) => (
          <InspectorLink
            key={related.id}
            label={related.label}
            detail={entityTypeLabel(related)}
            onClick={() => onInspect(related.id)}
          />
        ))}
      </div>
    </InspectorSection>
  );
}

function EntityDetails({
  document,
  baseUri,
  entity,
  origin,
  editing,
  pending,
  onEdit,
  onDone,
  onExplainRecord,
  onInspect,
  onSave,
  onRemove,
}: Omit<InspectorProps, "entity" | "onClose"> & {
  entity: BriefEntity;
  origin: EntityLinks["origin"];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  function save(edit: BriefEdit): string | undefined {
    const error = onSave?.(edit);
    if (!error) onDone();
    return error;
  }
  const remove =
    onRemove && canRemoveEntity(document, entity.id) ? () => onRemove(entity.id) : undefined;

  if (entity.type === "finding") {
    if (editing && onSave) {
      return (
        <FindingEditor
          section={entity.section}
          finding={entity.finding}
          onSave={(update) => save((brief) => updateFinding(brief, entity.id, update))}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        {entity.finding.whyItMatters && (
          <InspectorSection title="Why it matters">
            <Markdown plugins={{ code }} className="space-y-1 text-[11.5px] leading-relaxed">
              {entity.finding.whyItMatters}
            </Markdown>
          </InspectorSection>
        )}
        {entity.finding.exhibit && (
          <ExhibitCard
            document={document}
            exhibit={entity.finding.exhibit}
            baseUri={baseUri}
            onInspect={onInspect}
            compact
            embedded
            inspectable={false}
          />
        )}
        {entity.finding.sources && (
          <InspectorSection title="Sources" icon={<FileCode2 className="size-3" />}>
            <ul className="space-y-1">
              {entity.finding.sources.map((source) => (
                <li key={source}>
                  <code className="break-all text-[10px]">{source}</code>
                </li>
              ))}
            </ul>
          </InspectorSection>
        )}
        {(onSave || remove) && (
          <div className="flex flex-wrap gap-2">
            {onSave && <EditButton onClick={onEdit} />}
            {remove && (
              <RemoveButton
                label={`Remove finding: ${entity.finding.statement}`}
                onClick={remove}
              />
            )}
          </div>
        )}
      </>
    );
  }

  if (entity.type === "plan-step") {
    if (editing && onSave) {
      return (
        <PlanStepEditor
          section={entity.section}
          step={entity.step}
          onSave={(update) => save((brief) => updatePlanStep(brief, entity.id, update))}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        <InspectorSection title="Done when">
          <Markdown className="space-y-1.5">{entity.step.doneWhen}</Markdown>
        </InspectorSection>
        <FieldValues fields={entity.section.fields} values={entity.step.values} />
        {onSave && <EditButton onClick={onEdit} />}
      </>
    );
  }

  if (entity.type === "record") {
    const explanationPending = pending.has(
      briefActionKey({ action: "explain-record", recordId: entity.id }),
    );
    if (editing && onSave) {
      return (
        <RecordEditor
          section={entity.section}
          record={entity.record}
          onSave={(update) => save((brief) => updateRecord(brief, entity.id, update))}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        <FieldValues fields={entity.section.fields} values={entity.record.values} />
        {entity.record.explanation && (
          <InspectorSection title="Explanation">
            <p>{entity.record.explanation}</p>
          </InspectorSection>
        )}
        {entity.source && (
          <InspectorSection title="Source" icon={<FileCode2 className="size-3" />}>
            <code className="break-all text-[10px]">{entity.source}</code>
          </InspectorSection>
        )}
        {origin && (
          <InspectorSection title="Came from">
            <InspectorLink
              label={origin.option.label}
              detail={`${origin.decision.question} · ${DECISION_STATUS_PRESENTATION[origin.status].label}`}
              onClick={() => onInspect(origin.decision.id)}
            />
          </InspectorSection>
        )}
        {(onSave || onExplainRecord) && (
          <div className="flex flex-wrap gap-2">
            {onSave && <EditButton onClick={onEdit} />}
            {onExplainRecord && (
              <button
                type="button"
                disabled={explanationPending}
                onClick={() => onExplainRecord(entity.record.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-medium hover:bg-muted disabled:opacity-40"
              >
                <BookOpenText className="size-3.5" />
                {explanationPending
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
    const owner = entity.owner;
    if (editing && onSave) {
      return (
        <ExhibitEditor
          sourcePolicy={owner.kind === "section" ? owner.section.sourcePolicy : "optional"}
          allowExisting={owner.kind === "section"}
          exhibit={entity.exhibit}
          onSave={(update) => save((brief) => updateExhibit(brief, entity.id, update))}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        <ExhibitCard document={document} exhibit={entity.exhibit} baseUri={baseUri} compact />
        {owner.kind === "decision-option" && (
          <InspectorSection title="Defines this option">
            <InspectorLink
              label={owner.option.label}
              detail={owner.decision.question}
              onClick={() => onInspect(owner.decision.id)}
            />
          </InspectorSection>
        )}
        {(onSave || remove) && (
          <div className="flex flex-wrap gap-2">
            {onSave && <EditButton onClick={onEdit} />}
            {remove && (
              <RemoveButton label={`Remove ${entity.exhibit.title} from brief`} onClick={remove} />
            )}
          </div>
        )}
      </>
    );
  }

  if (entity.type === "question" && entity.question.answer) {
    return (
      <InspectorSection title="Answer">
        <p>{entity.question.answer}</p>
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
  fields: BriefField[];
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
          <dd className="mt-0.5 text-[11.5px]">
            <FieldValueText field={field} value={values[field.id]} />
          </dd>
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

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-medium text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="size-3.5" />
      Remove
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
  const option = activeOption(decision)?.option;
  return (
    <div className="space-y-1">
      <p>{DECISION_STATUS_PRESENTATION[decisionStatus(decision)].label}</p>
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

function entityTypeLabel(entity: BriefEntity): string {
  switch (entity.type) {
    case "plan-step":
      return entity.phase
        ? `${entity.section.title} · ${entity.phase.title}`
        : entity.section.title;
    case "record":
      return entity.section.title;
    case "finding":
      return `${entity.section.title} · Finding`;
    case "exhibit":
      return entity.owner.kind === "section"
        ? `${entity.owner.section.title} · ${exhibitKindLabel(entity.exhibit)}`
        : `${entity.owner.option.label} · ${exhibitKindLabel(entity.exhibit)}`;
    case "section":
      return "Section";
    case "question":
      return "Question to answer";
    case "decision":
      return "Choice to make";
  }
}
