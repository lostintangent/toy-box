import type { ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/shared/utils";
import {
  fieldValueText,
  planStatus,
  type IntentEntity,
  type IntentEntityId,
  type PlanState,
  type PlanPhase,
  type PlanSection,
  type PlanStep,
  type SpecState,
} from "../../model/index";
import { SectionEmptyState } from "../shared";

type VisiblePhase = {
  id: string;
  phase?: PlanPhase;
  steps: PlanStep[];
};

export function IntentPlanSection({
  spec,
  plan,
  section,
  showPlanSummary = true,
  focusedEntityId,
  onInspect,
}: {
  spec: SpecState;
  plan: PlanState;
  section: PlanSection;
  showPlanSummary?: boolean;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  const stepIds = new Set(plan.steps.map((step) => step.id));
  const phases: VisiblePhase[] =
    "phases" in section
      ? section.phases.flatMap((phase) => {
          const steps = phase.steps.filter((step) => stepIds.has(step.id));
          return steps.length > 0 ? [{ id: phase.id, phase, steps }] : [];
        })
      : section.steps.flatMap((step) =>
          stepIds.has(step.id) ? [{ id: step.id, steps: [step] }] : [],
        );

  const unsettled = [
    spec.openQuestions.length > 0
      ? `${spec.openQuestions.length} open question${spec.openQuestions.length === 1 ? "" : "s"}`
      : undefined,
    spec.unresolvedDecisions.length > 0
      ? `${spec.unresolvedDecisions.length} choice${spec.unresolvedDecisions.length === 1 ? "" : "s"} to make`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="space-y-3">
      {showPlanSummary && !spec.settled && (
        <PlanNotice>
          The spec is still unsettled. Settle {unsettled.join(" and ")} before executing this plan.
        </PlanNotice>
      )}

      {showPlanSummary && plan.unplannedRequirements.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
          <h2 className="text-xs font-semibold text-amber-300">Still needs a plan step</h2>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            No plan step implements these requirements.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {plan.unplannedRequirements.map((entity) => (
              <PlanEntityLink
                key={entity.id}
                entity={entity}
                focusedEntityId={focusedEntityId}
                onInspect={onInspect}
              />
            ))}
          </div>
        </section>
      )}

      {phases.length === 0 ? (
        <SectionEmptyState
          title={spec.settled ? "No plan steps implement this spec" : "No current plan steps yet"}
          detail={
            spec.settled
              ? "Update the plan so a step implements each requirement."
              : "This plan depends on choices that are not settled in the current spec."
          }
        />
      ) : (
        <ol className="space-y-5">
          {phases.map((phase, phaseIndex) => {
            const first = phase.steps[0];
            if (!first) return null;
            const status = planStatus(phase.steps);
            const phaseLabel = phase.phase?.title ?? `Step ${phaseIndex + 1}`;
            return (
              <li key={phase.id} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                <div className="relative flex justify-center">
                  {phaseIndex < phases.length - 1 && (
                    <div className="absolute -bottom-5 top-7 w-px bg-border" />
                  )}
                  {status === "complete" ? (
                    <span
                      role="img"
                      aria-label={`${phaseLabel} complete`}
                      className="relative inline-flex size-7 items-center justify-center rounded-full border border-emerald-500/50 bg-background text-emerald-400"
                    >
                      <Check aria-hidden className="size-3.5" />
                    </span>
                  ) : (
                    <span
                      aria-label={`${phaseLabel}${status === "in-progress" ? " in progress" : ""}`}
                      className={cn(
                        "relative inline-flex size-7 items-center justify-center rounded-full border bg-background text-[10px] font-semibold tabular-nums",
                        status === "in-progress"
                          ? "border-sky-500/50 text-sky-400"
                          : "border-border",
                      )}
                    >
                      {status === "in-progress" ? (
                        <Loader2 aria-hidden className="size-3.5 animate-spin" />
                      ) : (
                        phaseIndex + 1
                      )}
                    </span>
                  )}
                </div>
                {phase.phase ? (
                  <section className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xs font-semibold">{phase.phase.title}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                        {phase.steps.length} step{phase.steps.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {phase.steps.map((step) => (
                        <PlanStepCard
                          key={step.id}
                          section={section}
                          step={step}
                          targets={plan.targetsByStepId.get(step.id) ?? []}
                          focusedEntityId={focusedEntityId}
                          onInspect={onInspect}
                          wide
                        />
                      ))}
                    </div>
                  </section>
                ) : (
                  <PlanStepCard
                    section={section}
                    step={first}
                    targets={plan.targetsByStepId.get(first.id) ?? []}
                    focusedEntityId={focusedEntityId}
                    onInspect={onInspect}
                    wide
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function PlanStepCard({
  section,
  step,
  targets,
  focusedEntityId,
  onInspect,
  wide = false,
}: {
  section: PlanSection;
  step: PlanStep;
  targets: readonly IntentEntity[];
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
  wide?: boolean;
}) {
  const focused = step.id === focusedEntityId;
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
        onClick={() => onInspect(step.id)}
        aria-current={focused || undefined}
        className="block w-full p-3 text-left hover:bg-muted/30"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold">{step.title}</span>
          {step.status === "complete" ? (
            <Check
              role="img"
              aria-label={`${step.title} complete`}
              className="size-3 shrink-0 text-emerald-400"
            />
          ) : step.status === "in-progress" ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] font-medium text-sky-400">
              <Loader2 aria-hidden className="size-3 animate-spin" />
              In progress
            </span>
          ) : null}
        </span>
      </button>
      <dl
        className={cn(
          "border-t border-border/60 px-3 py-2.5",
          wide ? "grid gap-3 sm:grid-cols-2" : "space-y-2",
        )}
      >
        <div>
          <dt className="text-[9px] font-medium text-muted-foreground">Done when</dt>
          <dd className="mt-0.5 text-[10.5px] leading-relaxed text-foreground/90">
            {step.doneWhen}
          </dd>
        </div>
        {section.fields.map((field) => (
          <div key={field.id}>
            <dt className="text-[9px] font-medium text-muted-foreground">{field.label}</dt>
            <dd className="mt-0.5 text-[10.5px] leading-relaxed text-foreground/90">
              {fieldValueText(field, step.values[field.id])}
            </dd>
          </div>
        ))}
      </dl>
      <ul
        aria-label="Implements"
        className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2 text-[9.5px] text-muted-foreground"
      >
        {targets.map((entity) => {
          const focused = entity.id === focusedEntityId;
          return (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => onInspect(entity.id)}
                aria-current={focused || undefined}
                data-focused={focused || undefined}
                className={cn(
                  "rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-left text-[9.5px] hover:border-muted-foreground/50",
                  focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
                )}
              >
                {entity.label}
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function PlanEntityLink({
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

function PlanNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-[11px] text-amber-200">
      {children}
    </div>
  );
}
