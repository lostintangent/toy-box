import { useId, useState } from "react";
import {
  BookOpenText,
  Check,
  ChevronRight,
  GitBranch,
  GitFork,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/shared/utils";
import { briefActionKey } from "../actions";
import {
  clearDecisionChoice,
  decide,
  decisionStatus,
  findRecordsSection,
  briefEntities,
  recordLabel,
  reopenDecision,
  selectDecisionOption,
  unresolvedDependencies,
  type BriefDocument,
  type BriefEdit,
  type BriefEntityId,
  type Decision,
  type OptionAddition,
} from "../model/index";
import { ExhibitCard } from "./ExhibitsContent";
import {
  ChangeTag,
  DECISION_STATUS_PRESENTATION,
  FieldValueText,
  optionRelationshipLabel,
  Tag,
} from "./vocabulary";

function AdditionExplanation({
  item,
  pending,
  onExplainRecord,
}: {
  item: OptionAddition;
  pending: boolean;
  onExplainRecord?: (recordId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const explanation = item.explanation;
  const label = recordLabel(item);

  if (!explanation && !onExplainRecord && !pending) return null;

  function requestExplanation() {
    setOpen(true);
    onExplainRecord?.(item.id);
  }

  const hasAction = onExplainRecord || pending;
  const action = explanation ? "Explain further" : "Explain";
  const actionAria = explanation ? "Explain record further" : "Explain record";
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
            disabled={!onExplainRecord || pending}
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

/** Decisions whose options a reader can try, commit, revisit, or clear. */
export function DecisionsContent({
  document,
  decisions,
  baseUri,
  focusedEntityId,
  editable,
  pending,
  onExplainRecord,
  onInspect,
  onEdit,
}: {
  document: BriefDocument;
  decisions: Decision[];
  baseUri?: string;
  focusedEntityId?: BriefEntityId;
  editable: boolean;
  pending: ReadonlySet<string>;
  onExplainRecord?: (recordId: string) => void;
  onInspect?: (entityId: BriefEntityId) => void;
  onEdit: (edit: BriefEdit) => void;
}) {
  const entities = briefEntities(document);
  const entityLabel = (entityId: BriefEntityId) =>
    entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  return (
    <div className="space-y-3">
      {decisions.map((item) => {
        const dependencies = unresolvedDependencies(document, item);
        const blockedByDependency = dependencies.length > 0;
        const currentStatus = decisionStatus(item);
        const unresolved = currentStatus !== "decided";
        const status = DECISION_STATUS_PRESENTATION[currentStatus];

        return (
          <div
            key={item.id}
            className={cn(
              "rounded-lg border bg-muted/20 p-3",
              unresolved ? "border-rose-500/30" : "border-border/60",
            )}
          >
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 text-[12.5px] font-semibold">{item.question}</div>
              {unresolved && <Tag className="bg-rose-500/10 text-rose-400">needs you</Tag>}
              <Tag className={status.className}>{status.label}</Tag>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {item.options.map((option) => {
                const selected = option.id === item.choice?.optionId;
                const decided = selected && currentStatus === "decided";
                const additions = option.adds.map((addition) => ({
                  addition,
                  section: findRecordsSection(document, addition.sectionId),
                }));
                const targetTitles = [
                  ...new Set(
                    additions.map(({ addition, section }) => section?.title ?? addition.sectionId),
                  ),
                ];
                const optionRelationships = option.relationships ?? [];
                const impactCount =
                  option.adds.length + optionRelationships.length + (option.exhibit ? 1 : 0);

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
                      onClick={() =>
                        onEdit((brief) => selectDecisionOption(brief, item.id, option.id))
                      }
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
                    {option.exhibit && (
                      <div className="mx-2.5 mb-2.5">
                        <ExhibitCard
                          document={document}
                          exhibit={option.exhibit}
                          baseUri={baseUri}
                          focusedEntityId={focusedEntityId}
                          onInspect={onInspect}
                          compact
                          embedded
                        />
                      </div>
                    )}
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
                                  <ChangeTag change={addition.change} source={addition.source} />
                                </div>
                                {section && section.fields.length > 0 && (
                                  <div className="mt-0.5 space-y-0.5 text-[10px] text-muted-foreground">
                                    {section.fields.map((field) => (
                                      <div key={field.id} className="flex items-start gap-1">
                                        <span className="shrink-0 font-medium">{field.label}:</span>
                                        <FieldValueText
                                          field={field}
                                          value={addition.values[field.id]}
                                          className="min-w-0 space-y-1"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <AdditionExplanation
                                  item={addition}
                                  pending={pending.has(
                                    briefActionKey({
                                      action: "explain-record",
                                      recordId: addition.id,
                                    }),
                                  )}
                                  onExplainRecord={onExplainRecord}
                                />
                              </div>
                            </div>
                          ))}
                          {optionRelationships.map((relationship) => (
                            <div key={relationship.id} className="flex items-start gap-1.5">
                              <GitFork className="mt-0.5 size-3 shrink-0 text-sky-400" />
                              <span>
                                {entityLabel(relationship.from)}{" "}
                                {optionRelationshipLabel(relationship)}{" "}
                                {entityLabel(relationship.to)}
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

            {editable && currentStatus === "provisional" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={blockedByDependency}
                  onClick={() => onEdit((brief) => decide(brief, item.id))}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10.5px] font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check className="size-3" />
                  Use this
                </button>
                <button
                  type="button"
                  onClick={() => onEdit((brief) => clearDecisionChoice(brief, item.id))}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-3" />
                  Clear
                </button>
              </div>
            )}
            {editable && currentStatus === "decided" && (
              <button
                type="button"
                onClick={() => onEdit((brief) => reopenDecision(brief, item.id))}
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
