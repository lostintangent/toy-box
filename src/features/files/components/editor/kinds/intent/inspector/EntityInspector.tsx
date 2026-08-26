import { useState, type ReactNode } from "react";
import { code } from "@streamdown/code";
import { BookOpenText, FileCode2, GitFork, Pencil, Trash2 } from "lucide-react";
import { Streamdown } from "streamdown";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import {
  activeOptionRelationships,
  decisionOriginForRecord,
  decisionStatus,
  entitiesGroundedByFinding,
  entityFlowConnections,
  fieldValueText,
  findingsForEntity,
  intentEntities,
  planSections,
  planSteps,
  selectedDecisionOption,
  type Decision,
  type Finding,
  type FindingUpdate,
  type IntentDocument,
  type IntentEntity,
  type IntentEntityId,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type IntentField,
  type IntentRecord,
  type IntentRecordUpdate,
  type OptionAddition,
  type PlanStep,
  type PlanStepUpdate,
} from "../model/index";
import { IntentExhibitEditor } from "./ExhibitEditor";
import { IntentFindingEditor } from "./FindingEditor";
import { PlanStepEditor } from "./PlanStepEditor";
import { IntentRecordEditor } from "./RecordEditor";
import { exhibitKindLabel, IntentExhibitCard } from "../sections";
import { ChangeTag, decisionStatusLabel, optionRelationshipLabel } from "../sections/shared";

type UpdateRecord = (
  recordId: string,
  update: IntentRecordUpdate,
  original: IntentRecord | OptionAddition,
) => string | undefined;

type UpdatePlanStep = (
  stepId: string,
  update: PlanStepUpdate,
  original: PlanStep,
) => string | undefined;

type UpdateExhibit = (
  exhibitId: string,
  update: IntentExhibitUpdate,
  original: IntentExhibit,
) => string | undefined;

type RemoveExhibit = (sectionId: string, exhibitId: string) => void;

type UpdateFinding = (
  findingId: string,
  update: FindingUpdate,
  original: Finding,
) => string | undefined;

type RemoveFinding = (sectionId: string, findingId: string) => void;

type InspectorProps = {
  document: IntentDocument;
  baseUri?: string;
  entity?: IntentEntity;
  pending: ReadonlySet<string>;
  onClose: () => void;
  onExplainRecord?: (recordId: string) => void;
  onInspect: (entityId: IntentEntityId) => void;
  onUpdateRecord?: UpdateRecord;
  onUpdatePlanStep?: UpdatePlanStep;
  onUpdateExhibit?: UpdateExhibit;
  onRemoveExhibit?: RemoveExhibit;
  onUpdateFinding?: UpdateFinding;
  onRemoveFinding?: RemoveFinding;
};

export function IntentEntityInspector({
  document,
  baseUri,
  entity,
  pending,
  onClose,
  onExplainRecord,
  onInspect,
  onUpdateRecord,
  onUpdatePlanStep,
  onUpdateExhibit,
  onRemoveExhibit,
  onUpdateFinding,
  onRemoveFinding,
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
            onUpdateRecord={onUpdateRecord}
            onUpdatePlanStep={onUpdatePlanStep}
            onUpdateExhibit={onUpdateExhibit}
            onRemoveExhibit={onRemoveExhibit}
            onUpdateFinding={onUpdateFinding}
            onRemoveFinding={onRemoveFinding}
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
  onUpdateRecord,
  onUpdatePlanStep,
  onUpdateExhibit,
  onRemoveExhibit,
  onUpdateFinding,
  onRemoveFinding,
}: Omit<InspectorProps, "entity" | "onClose"> & { entity: IntentEntity }) {
  const [editing, setEditing] = useState(false);
  const entities = new Map(intentEntities(document).map((item) => [item.id, item]));
  const optionRelationships = activeOptionRelationships(document).filter(
    ({ relationship }) => relationship.from === entity.id || relationship.to === entity.id,
  );
  const flowConnections = entityFlowConnections(document, entity.id);
  const documentPlanSections = planSections(document);
  const implementationTargets =
    entity.type === "plan-step"
      ? entity.step.implements.flatMap((entityId) => {
          const target = entities.get(entityId);
          return target ? [target] : [];
        })
      : [];
  const implementingSteps =
    entity.type !== "plan-step"
      ? documentPlanSections.flatMap((section) =>
          planSteps(section).flatMap((step) => {
            if (!step.implements.includes(entity.id)) return [];
            const stepEntity = entities.get(step.id);
            return stepEntity?.type === "plan-step" ? [stepEntity] : [];
          }),
        )
      : [];
  const affected =
    entity.type === "question"
      ? entity.question.affects
      : entity.type === "decision"
        ? entity.decision.affects
        : [];
  const groundingFindings = findingsForEntity(document, entity.id);
  const groundedEntities =
    entity.type === "finding" ? entitiesGroundedByFinding(document, entity.id) : [];

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
          editing={editing}
          pending={pending}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onExplainRecord={onExplainRecord}
          onInspect={onInspect}
          onUpdateRecord={onUpdateRecord}
          onUpdatePlanStep={onUpdatePlanStep}
          onUpdateExhibit={onUpdateExhibit}
          onRemoveExhibit={onRemoveExhibit}
          onUpdateFinding={onUpdateFinding}
          onRemoveFinding={onRemoveFinding}
        />
        {!editing && groundingFindings.length > 0 && (
          <InspectorSection title="Based on">
            <div className="space-y-2">
              {groundingFindings.map((finding) => (
                <InspectorLink
                  key={finding.id}
                  label={finding.statement}
                  detail="Finding"
                  onClick={() => onInspect(finding.id)}
                />
              ))}
            </div>
          </InspectorSection>
        )}
        {!editing && groundedEntities.length > 0 && (
          <InspectorSection title="Grounds">
            <div className="space-y-2">
              {groundedEntities.map((grounded) => (
                <InspectorLink
                  key={grounded.id}
                  label={grounded.label}
                  detail={entityTypeLabel(grounded)}
                  onClick={() => onInspect(grounded.id)}
                />
              ))}
            </div>
          </InspectorSection>
        )}
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
        {!editing && implementationTargets.length > 0 && (
          <InspectorSection title="Implements">
            <div className="space-y-2">
              {implementationTargets.map((target) => (
                <InspectorLink
                  key={target.id}
                  label={target.label}
                  detail={entityTypeLabel(target)}
                  onClick={() => onInspect(target.id)}
                />
              ))}
            </div>
          </InspectorSection>
        )}
        {!editing && implementingSteps.length > 0 && (
          <InspectorSection title="Plan steps">
            <div className="space-y-2">
              {implementingSteps.map((step) => (
                <InspectorLink
                  key={step.id}
                  label={step.label}
                  detail={entityTypeLabel(step)}
                  onClick={() => onInspect(step.id)}
                />
              ))}
            </div>
          </InspectorSection>
        )}
        {!editing && flowConnections.length > 0 && (
          <InspectorSection title="Flows" icon={<GitFork className="size-3" />}>
            <div className="space-y-2">
              {flowConnections.map(({ flow, connection, outgoing, related }) => (
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
        {!editing && optionRelationships.length > 0 && (
          <InspectorSection title="Option relationships" icon={<GitFork className="size-3" />}>
            <div className="space-y-2">
              {optionRelationships.map((effective) => {
                const outgoing = effective.relationship.from === entity.id;
                const related = entities.get(
                  outgoing ? effective.relationship.to : effective.relationship.from,
                );
                if (!related) return null;
                const status = ` · ${effective.optionLabel} (${decisionStatusLabel(effective.status)})`;
                return (
                  <InspectorLink
                    key={effective.relationship.id}
                    eyebrow={`${outgoing ? "→ " : "← "}${optionRelationshipLabel(effective.relationship)}${status}`}
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
  document,
  baseUri,
  entity,
  editing,
  pending,
  onEdit,
  onDone,
  onExplainRecord,
  onInspect,
  onUpdateRecord,
  onUpdatePlanStep,
  onUpdateExhibit,
  onRemoveExhibit,
  onUpdateFinding,
  onRemoveFinding,
}: Omit<InspectorProps, "entity" | "onClose"> & {
  entity: IntentEntity;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  if (entity.type === "finding") {
    if (editing && onUpdateFinding) {
      return (
        <IntentFindingEditor
          section={entity.section}
          finding={entity.finding}
          onSave={(update, original) => {
            const error = onUpdateFinding(entity.finding.id, update, original);
            if (!error) onDone();
            return error;
          }}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        {entity.finding.whyItMatters && (
          <InspectorSection title="Why it matters">
            <Streamdown
              mode="static"
              plugins={{ code }}
              className="space-y-1 text-[11.5px] leading-relaxed [&_ol]:my-1 [&_p]:my-0 [&_pre]:my-1 [&_ul]:my-1"
            >
              {entity.finding.whyItMatters}
            </Streamdown>
          </InspectorSection>
        )}
        {entity.finding.exhibit && (
          <IntentExhibitCard
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
        {(onUpdateFinding || onRemoveFinding) && (
          <div className="flex flex-wrap gap-2">
            {onUpdateFinding && <EditButton onClick={onEdit} />}
            {onRemoveFinding && (
              <RemoveButton
                label={`Remove finding: ${entity.finding.statement}`}
                onClick={() => onRemoveFinding(entity.section.id, entity.finding.id)}
              />
            )}
          </div>
        )}
      </>
    );
  }

  if (entity.type === "plan-step") {
    if (editing && onUpdatePlanStep) {
      return (
        <PlanStepEditor
          section={entity.section}
          step={entity.step}
          onSave={(update, original) => {
            const error = onUpdatePlanStep(entity.step.id, update, original);
            if (!error) onDone();
            return error;
          }}
          onCancel={onDone}
        />
      );
    }
    return (
      <>
        <InspectorSection title="Done when">
          <p>{entity.step.doneWhen}</p>
        </InspectorSection>
        <FieldValues fields={entity.section.fields} values={entity.step.values} />
        {onUpdatePlanStep && <EditButton onClick={onEdit} />}
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
    const origin = decisionOriginForRecord(document, entity.record.id);
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
              detail={`${origin.decision.question} · ${decisionStatusLabel(origin.status)}`}
              onClick={() => onInspect(origin.decision.id)}
            />
          </InspectorSection>
        )}
        {(onUpdateRecord || onExplainRecord) && (
          <div className="flex flex-wrap gap-2">
            {onUpdateRecord && <EditButton onClick={onEdit} />}
            {onExplainRecord && (
              <button
                type="button"
                disabled={pending.has(`explain-record:${entity.record.id}`)}
                onClick={() => onExplainRecord(entity.record.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-medium hover:bg-muted disabled:opacity-40"
              >
                <BookOpenText className="size-3.5" />
                {pending.has(`explain-record:${entity.record.id}`)
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
    if (editing && onUpdateExhibit) {
      return (
        <IntentExhibitEditor
          sourcePolicy={owner.kind === "section" ? owner.section.sourcePolicy : "optional"}
          allowExisting={owner.kind === "section"}
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
        <IntentExhibitCard document={document} exhibit={entity.exhibit} baseUri={baseUri} compact />
        {owner.kind === "decision-option" && (
          <InspectorSection title="Defines this option">
            <InspectorLink
              label={owner.option.label}
              detail={owner.decision.question}
              onClick={() => onInspect(owner.decision.id)}
            />
          </InspectorSection>
        )}
        {(onUpdateExhibit ||
          (owner.kind === "section" && entity.exhibit.change === "new" && onRemoveExhibit)) && (
          <div className="flex flex-wrap gap-2">
            {onUpdateExhibit && <EditButton onClick={onEdit} />}
            {owner.kind === "section" && entity.exhibit.change === "new" && onRemoveExhibit && (
              <RemoveButton
                label={`Remove ${entity.exhibit.title} from intent`}
                onClick={() => onRemoveExhibit(owner.section.id, entity.exhibit.id)}
              />
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
  const option = selectedDecisionOption(decision);
  return (
    <div className="space-y-1">
      <p>{decisionStatusLabel(decisionStatus(decision))}</p>
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

function entityTypeLabel(entity: IntentEntity): string {
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
