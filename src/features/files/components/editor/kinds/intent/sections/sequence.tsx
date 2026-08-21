import type { ReactNode } from "react";
import { cn } from "@/shared/utils";
import {
  deliveryProjection,
  fieldValueText,
  reviewReadiness,
  type DeliveryWorkUnit,
  type IntentDefinition,
  type IntentEntity,
  type IntentEntityId,
  type SequenceSection,
} from "../model/index";
import { SectionEmptyState } from "./shared";

export function IntentSequenceSection({
  definition,
  section,
  focusedEntityId,
  onInspect,
}: {
  definition: IntentDefinition;
  section: SequenceSection;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  const delivery = deliveryProjection(definition);
  const approval = reviewReadiness(definition);
  const workUnits = delivery.workUnits.filter((unit) => unit.entity.section.id === section.id);
  const phases = delivery.phases
    .map((phase) => phase.filter((unit) => unit.entity.section.id === section.id))
    .filter((phase) => phase.length > 0);
  const cyclic = delivery.cyclic.filter((unit) => unit.entity.section.id === section.id);

  if (workUnits.length === 0) {
    return (
      <SectionEmptyState
        title="No work is active yet"
        detail="This sequence depends on choices that are not settled in the current intent."
      />
    );
  }

  const unsettled = [
    approval.openQuestions.length > 0
      ? `${approval.openQuestions.length} open question${approval.openQuestions.length === 1 ? "" : "s"}`
      : undefined,
    approval.blockingDecisions.length > 0
      ? `${approval.blockingDecisions.length} choice${approval.blockingDecisions.length === 1 ? "" : "s"} to make`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="space-y-3">
      {!approval.approvable && (
        <SequenceNotice>
          This sequence only covers what is agreed so far. Settle {unsettled.join(" and ")} before
          starting the work.
        </SequenceNotice>
      )}

      {delivery.uncovered.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
          <h2 className="text-xs font-semibold text-amber-300">Still needs a home</h2>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            These agreed items still need to be covered by the work below.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {delivery.uncovered.map((entity) => (
              <DeliveryEntityLink
                key={entity.id}
                entity={entity}
                focusedEntityId={focusedEntityId}
                onInspect={onInspect}
              />
            ))}
          </div>
        </section>
      )}

      <ol className="space-y-5">
        {phases.map((phase, phaseIndex) => {
          const first = phase[0];
          if (!first) return null;
          const stage = "stages" in section ? section.stages[phaseIndex] : undefined;
          const direct = !stage && phase.length === 1;
          return (
            <li
              key={stage?.id ?? first.entity.id}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3"
            >
              <div className="relative flex justify-center">
                {phaseIndex < phases.length - 1 && (
                  <div className="absolute inset-y-8 w-px bg-border" />
                )}
                <span className="relative inline-flex size-7 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold tabular-nums">
                  {phaseIndex + 1}
                </span>
              </div>
              {direct ? (
                <DeliveryWorkCard
                  unit={first}
                  focusedEntityId={focusedEntityId}
                  onInspect={onInspect}
                  wide
                />
              ) : (
                <section className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xs font-semibold">
                      {stage?.title ??
                        (phaseIndex === 0 ? "Can start now" : "Opens after earlier work")}
                    </h2>
                    {phase.length > 1 && (
                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[9.5px] font-medium text-sky-400">
                        {phase.length} pieces can move together
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {phase.map((unit) => (
                      <DeliveryWorkCard
                        key={unit.entity.id}
                        unit={unit}
                        focusedEntityId={focusedEntityId}
                        onInspect={onInspect}
                      />
                    ))}
                  </div>
                </section>
              )}
            </li>
          );
        })}
      </ol>

      {cyclic.length > 0 && (
        <SequenceNotice>
          The sequence could not place {cyclic.length} work item
          {cyclic.length === 1 ? "" : "s"}. Break the circular dependency before starting.
        </SequenceNotice>
      )}
    </div>
  );
}

function DeliveryWorkCard({
  unit,
  focusedEntityId,
  onInspect,
  wide = false,
}: {
  unit: DeliveryWorkUnit;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
  wide?: boolean;
}) {
  const focused = unit.entity.id === focusedEntityId;
  return (
    <article
      data-focused={focused || undefined}
      className={cn(
        "overflow-hidden rounded-lg border border-border/70 bg-background",
        focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
      )}
    >
      <button
        type="button"
        onClick={() => onInspect(unit.entity.id)}
        aria-current={focused || undefined}
        className="block w-full p-3 text-left hover:bg-muted/30"
      >
        <span className="text-[11.5px] font-semibold">{unit.entity.label}</span>
      </button>
      {unit.entity.section.fields.length > 0 && (
        <dl
          className={cn(
            "border-t border-border/60 px-3 py-2.5",
            wide ? "grid gap-3 sm:grid-cols-2" : "space-y-2",
          )}
        >
          {unit.entity.section.fields.map((field) => (
            <div key={field.id}>
              <dt className="text-[9px] font-medium text-muted-foreground">{field.label}</dt>
              <dd className="mt-0.5 text-[10.5px] leading-relaxed text-foreground/90">
                {fieldValueText(field, unit.entity.work.values[field.id])}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {unit.coverage.length > 0 ? (
        <ul
          aria-label="Intent sources"
          className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2 text-[9.5px] text-muted-foreground"
        >
          {unit.coverage.map(({ relation, source }) => {
            const focused = source.id === focusedEntityId;
            return (
              <li key={relation.relation.id}>
                <button
                  type="button"
                  onClick={() => onInspect(source.id)}
                  aria-current={focused || undefined}
                  data-focused={focused || undefined}
                  className={cn(
                    "rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-left text-[9.5px] hover:border-muted-foreground/50",
                    focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
                  )}
                >
                  {source.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-border/60 px-3 py-2 text-[9.5px] text-muted-foreground">
          Enables later work; no intent source links here directly.
        </p>
      )}
    </article>
  );
}

function DeliveryEntityLink({
  entity,
  focusedEntityId,
  onInspect,
}: {
  entity: IntentEntity;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  const focused = entity.id === focusedEntityId;
  return (
    <button
      type="button"
      onClick={() => onInspect(entity.id)}
      aria-current={focused || undefined}
      data-focused={focused || undefined}
      className={cn(
        "rounded-lg border border-amber-500/20 bg-background/60 p-2.5 text-left hover:border-amber-400/50",
        focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
      )}
    >
      <span className="text-[10.5px] font-medium">{entity.label}</span>
      {entity.detail && (
        <span className="mt-1 block line-clamp-2 text-[9.5px] text-muted-foreground">
          {entity.detail}
        </span>
      )}
    </button>
  );
}

function SequenceNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-[11px] text-amber-200">
      {children}
    </div>
  );
}
