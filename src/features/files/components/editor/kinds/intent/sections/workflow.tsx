import { useId, useState } from "react";
import {
  BookOpenText,
  Check,
  ChevronRight,
  CircleCheck,
  FlaskConical,
  GitBranch,
  GitFork,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/shared/utils";
import {
  fieldValueText,
  findRecordsSection,
  intentEntities,
  recordLabel,
  unresolvedDependencies,
  type Decision,
  type IntentDefinition,
  type IntentEntityId,
  type OptionAddition,
  type Question,
} from "../model/index";
import { ChangeTag, intentRelationLabel, Tag } from "./shared";

const DECISION_STATUS: Record<Decision["status"], { label: string; className: string }> = {
  decided: { label: "Decided", className: "bg-emerald-500/10 text-emerald-400" },
  provisional: { label: "Trying", className: "bg-amber-500/10 text-amber-400" },
  open: { label: "Open", className: "bg-zinc-500/10 text-zinc-400" },
};

const RESOLUTION_METHOD_LABEL: Record<Question["resolutionMethod"], string> = {
  "investigate-code": "Check the code",
  "run-experiment": "Try it",
};

function AdditionExplanation({
  item,
  pending,
  onExplain,
}: {
  item: OptionAddition;
  pending: boolean;
  onExplain?: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const explanation = item.explanation;
  const label = recordLabel(item);

  if (!explanation && !onExplain && !pending) return null;

  function requestExplanation() {
    setOpen(true);
    onExplain?.(item.id);
  }

  const hasAction = onExplain || pending;
  const action = explanation ? "Explain further" : "Explain";
  const actionAria = explanation ? "Explain item further" : "Explain item";
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {explanation && (
          <button
            type="button"
            aria-controls={contentId}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} explanation for ${label}`}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
            Why this matters
          </button>
        )}
        {hasAction && (
          <button
            type="button"
            aria-label={`${actionAria}: ${label}`}
            disabled={!onExplain || pending}
            onClick={requestExplanation}
            className={cn(
              "inline-flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
              !explanation && "rounded-md border border-border px-2 py-1",
            )}
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <BookOpenText className="size-3" />
            )}
            {pending ? `${explanation ? "Expanding" : "Explaining"}...` : action}
          </button>
        )}
      </div>
      {explanation && (
        <div
          id={contentId}
          hidden={!open}
          className="mt-1.5 whitespace-pre-wrap border-l border-border pl-2.5 text-[10.5px] text-muted-foreground"
        >
          {explanation}
        </div>
      )}
    </div>
  );
}

export function DecisionsSection({
  definition,
  decisions,
  editable,
  pending,
  onExplain,
  onChoose,
  onRecord,
  onReopen,
  onClear,
}: {
  definition: IntentDefinition;
  decisions: Decision[];
  editable: boolean;
  pending: ReadonlySet<string>;
  onExplain?: (itemId: string) => void;
  onChoose: (decisionId: string, optionId: string) => void;
  onRecord: (decisionId: string) => void;
  onReopen: (decisionId: string) => void;
  onClear: (decisionId: string) => void;
}) {
  const entities = intentEntities(definition);
  const entityLabel = (entityId: IntentEntityId) =>
    entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  return (
    <div className="space-y-3">
      {decisions.map((item) => {
        const dependencies = unresolvedDependencies(definition, item);
        const blockedByDependency = dependencies.length > 0;
        const blocksApproval = item.blocking && (item.status !== "decided" || blockedByDependency);
        const status = DECISION_STATUS[item.status];

        return (
          <div
            key={item.id}
            className={cn(
              "rounded-lg border bg-muted/20 p-3",
              blocksApproval ? "border-rose-500/30" : "border-border/60",
            )}
          >
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 text-[12.5px] font-semibold">{item.question}</div>
              {blocksApproval && <Tag className="bg-rose-500/10 text-rose-400">needs you</Tag>}
              <Tag className={status.className}>{status.label}</Tag>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {item.options.map((option) => {
                const selected = option.id === item.chosen;
                const decided = selected && item.status === "decided";
                const additions = option.adds.map((addition) => ({
                  addition,
                  section: findRecordsSection(definition, addition.sectionId),
                }));
                const targetTitles = [
                  ...new Set(
                    additions.map(({ addition, section }) => section?.title ?? addition.sectionId),
                  ),
                ];
                const impactCount = option.adds.length + option.relations.length;

                return (
                  <div
                    key={option.id}
                    className={cn(
                      "rounded-lg border transition-colors",
                      decided
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : selected
                          ? "border-amber-500/50 bg-amber-500/10"
                          : "border-border bg-background hover:border-muted-foreground/40",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={!editable}
                      onClick={() => onChoose(item.id, option.id)}
                      className={cn(
                        "block w-full p-2.5 text-left",
                        !editable && "cursor-default opacity-70",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                            decided
                              ? "border-emerald-400 bg-emerald-500 text-background"
                              : selected
                                ? "border-amber-400 bg-amber-500 text-background"
                                : "border-muted-foreground/40",
                          )}
                        >
                          {selected && <Check className="size-2.5" />}
                        </span>
                        <span className="text-[11.5px] font-medium">{option.label}</span>
                      </div>
                      {option.rationale && (
                        <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                          {option.rationale}
                        </div>
                      )}
                      {option.tradeoff && (
                        <div className="mt-1 text-[10.5px] text-amber-400/90">
                          Tradeoff: {option.tradeoff}
                        </div>
                      )}
                    </button>
                    {impactCount > 0 && (
                      <details className="mx-2.5 mb-2.5 border-t border-border/50 pt-2 text-[10.5px]">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          {selected
                            ? "What this choice changes"
                            : `${impactCount} thing${impactCount === 1 ? "" : "s"} would change`}
                          {targetTitles.length > 0 ? ` in ${targetTitles.join(", ")}` : ""}
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {additions.map(({ addition, section }) => (
                            <div
                              key={addition.id}
                              className="flex items-start gap-1.5 text-foreground/85"
                            >
                              <GitBranch className="mt-0.5 size-3 shrink-0 text-violet-400" />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span>{section?.title ?? addition.sectionId}:</span>
                                  {addition.subject && <span>{addition.subject}</span>}
                                  <ChangeTag
                                    change={addition.change}
                                    provenance={addition.provenance}
                                  />
                                </div>
                                {section && section.fields.length > 0 && (
                                  <div className="mt-0.5 space-y-0.5 text-[10px] text-muted-foreground">
                                    {section.fields.map((field) => (
                                      <div key={field.id}>
                                        <span className="font-medium">{field.label}: </span>
                                        {fieldValueText(field, addition.values[field.id])}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <AdditionExplanation
                                  item={addition}
                                  pending={pending.has(`explain-item:${addition.id}`)}
                                  onExplain={onExplain}
                                />
                              </div>
                            </div>
                          ))}
                          {option.relations.map((relation) => (
                            <div key={relation.id} className="flex items-start gap-1.5">
                              <GitFork className="mt-0.5 size-3 shrink-0 text-sky-400" />
                              <span>
                                {entityLabel(relation.from)} {intentRelationLabel(relation)}{" "}
                                {entityLabel(relation.to)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            {item.rationale && (
              <div className="mt-2 text-[11px] text-muted-foreground">{item.rationale}</div>
            )}
            {dependencies.length > 0 && (
              <div className="mt-2 rounded-md bg-rose-500/10 px-2 py-1.5 text-[10.5px] text-rose-400">
                Needs answers from:{" "}
                {dependencies.map((dependency) => dependency.question).join(" · ")}
              </div>
            )}

            {editable && item.status === "provisional" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={blockedByDependency}
                  onClick={() => onRecord(item.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10.5px] font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check className="size-3" />
                  Use this
                </button>
                <button
                  type="button"
                  onClick={() => onClear(item.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-3" />
                  Clear
                </button>
              </div>
            )}
            {editable && item.status === "decided" && (
              <button
                type="button"
                onClick={() => onReopen(item.id)}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                Revisit
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function QuestionsSection({
  questions,
  editable,
  pending,
  onInvestigate,
  onReopen,
}: {
  questions: Question[];
  editable: boolean;
  pending: ReadonlySet<string>;
  onInvestigate?: (questionId: string) => void;
  onReopen?: (questionId: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      {questions.map((item) => {
        const resolved = Boolean(item.resolution);
        const busy = pending.has(`investigate-question:${item.id}`);
        const experiment = item.resolutionMethod === "run-experiment";
        const InvestigationIcon = experiment ? FlaskConical : GitBranch;
        const investigationLabel = experiment ? "Try it" : "Check code";
        return (
          <div
            key={item.id}
            className={cn(
              "rounded-lg border border-l-2 bg-muted/20 p-2.5",
              resolved ? "border-l-emerald-500/70 opacity-70" : "border-l-rose-500",
            )}
          >
            <div className="text-[12px]">{item.question}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Tag className="bg-zinc-500/10 text-zinc-400">
                {RESOLUTION_METHOD_LABEL[item.resolutionMethod]}
              </Tag>
            </div>
            {item.effect && (
              <div className="mt-1 text-[10.5px] text-muted-foreground">{item.effect}</div>
            )}
            {resolved ? (
              <div className="mt-1">
                <div className="flex items-start gap-1 text-[10.5px] text-emerald-400">
                  <CircleCheck className="mt-0.5 size-3 shrink-0" />
                  {item.resolution}
                </div>
                {editable && onReopen && (
                  <button
                    type="button"
                    onClick={() => onReopen(item.id)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                    Revisit question
                  </button>
                )}
              </div>
            ) : (
              (editable || busy) && (
                <button
                  type="button"
                  disabled={!onInvestigate || busy}
                  onClick={() => onInvestigate?.(item.id)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10.5px] text-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <InvestigationIcon className="size-3" />
                  )}
                  {busy ? "Pending..." : investigationLabel}
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
