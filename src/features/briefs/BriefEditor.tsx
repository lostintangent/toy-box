import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  PanelRightOpen,
  Play,
  SearchCheck,
  TableOfContents,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";
import { briefActionKey, type BriefAction } from "./actions";
import {
  canRegenerateSection,
  canRemoveEntity,
  findBriefEntity,
  parseBrief,
  planExecuting,
  planState,
  resolveBriefTabs,
  specState,
  serializeBrief,
  removeEntity,
  setRecordsView,
  setSectionsCollapsed,
  type BriefDocument,
  type BriefEdit,
  type BriefEntityId,
  type RecordsView,
  type ResolvedBriefTab,
} from "./model/index";
import { EntityInspector } from "./inspector/EntityInspector";
import { PlanContent } from "./sections/PlanContent";
import { SectionContent } from "./sections/SectionContent";
import { countSectionItems, SectionPanel } from "./sections/SectionPanel";

type RemovalUndo = {
  previousDocument: BriefDocument;
  label: string;
};

export type BriefEditorProps = {
  content: string;
  revision: number;
  readOnly: boolean;
  compact: boolean;
  baseUri?: string;
  pendingActions: readonly BriefAction[];
  /** Whether the agent that owns this document is running or waiting on the user. */
  ownerActive: boolean;
  onContentChange: (content: string) => void;
  onRunAction?: (request: BriefAction) => Promise<void>;
};

const CONTENTS_CLOSE_DELAY_MS = 120;

function briefSectionElementId(sectionId: string): string {
  return `brief-section-${sectionId}`;
}

function briefSectionIsOpen(
  editable: boolean,
  sectionOpenById: Readonly<Record<string, boolean>>,
  sectionId: string,
  collapsed: boolean,
): boolean {
  return editable ? !collapsed : (sectionOpenById[sectionId] ?? !collapsed);
}

function BriefTableOfContents({
  sections,
  onNavigate,
}: {
  sections: BriefDocument["sections"];
  onNavigate: (sectionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const openedByPointerRef = useRef(false);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  function cancelClose() {
    if (closeTimerRef.current === undefined) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }

  function openFromPointer() {
    cancelClose();
    if (open) return;
    openedByPointerRef.current = true;
    setOpen(true);
  }

  function scheduleClose() {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setOpen(false);
    }, CONTENTS_CLOSE_DELAY_MS);
  }

  function changeOpen(nextOpen: boolean) {
    cancelClose();
    openedByPointerRef.current = false;
    setOpen(nextOpen);
  }

  function navigate(sectionId: string) {
    changeOpen(false);
    onNavigate(sectionId);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Table of contents"
            onPointerEnter={openFromPointer}
            onPointerLeave={scheduleClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <TableOfContents aria-hidden className="size-3.5" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-64 p-1.5"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        initialFocus={() => !openedByPointerRef.current}
        finalFocus={false}
      >
        <nav aria-label="Brief sections">
          <ol className="space-y-0.5">
            {sections.map((section, index) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-controls={briefSectionElementId(section.id)}
                  onClick={() => navigate(section.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="w-4 shrink-0 text-right text-[9px] tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate">{section.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </PopoverContent>
    </Popover>
  );
}

function BriefTabPicker({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: ResolvedBriefTab[];
  activeTab: ResolvedBriefTab;
  onSelect: (sectionId: string) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Brief tab: ${activeTab.title}`}
            className="inline-flex h-8 max-w-52 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          />
        }
      >
        <span className="truncate">{activeTab.title}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40" finalFocus={false}>
        {tabs.map((tab) => {
          const anchor = tab.sections[0];
          if (!anchor) return null;
          const active = tab === activeTab;
          return (
            <DropdownMenuItem
              key={anchor.id}
              aria-current={active ? "page" : undefined}
              className="text-xs"
              onClick={() => onSelect(anchor.id)}
            >
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              {active && <Check aria-hidden className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BriefEditor({
  content,
  revision,
  readOnly,
  compact,
  baseUri,
  pendingActions,
  ownerActive,
  onContentChange,
  onRunAction,
}: BriefEditorProps) {
  const editable = !readOnly;
  const [buffer, setBuffer] = useState(() => ({
    revision,
    parsed: parseBrief(content),
  }));
  const [removalUndo, setRemovalUndo] = useState<RemovalUndo>();
  const [sectionOpenById, setSectionOpenById] = useState<Readonly<Record<string, boolean>>>({});
  const [recordsViewById, setRecordsViewById] = useState<Readonly<Record<string, RecordsView>>>({});
  const [selectedTabSectionId, setSelectedTabSectionId] = useState<string>();
  const [selectedEntityId, setSelectedEntityId] = useState<BriefEntityId>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [submittingActions, setSubmittingActions] = useState<ReadonlySet<string>>(() => new Set());
  const [actionFailed, setActionFailed] = useState(false);
  const actionMutation = useMutation({
    mutationFn: (request: BriefAction) => {
      if (!onRunAction) {
        return Promise.reject(new Error("Brief actions aren't available."));
      }
      return onRunAction(request);
    },
    onError: () => setActionFailed(true),
    onSettled: (_data, _error, request) => {
      const key = briefActionKey(request);
      setSubmittingActions((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    },
  });

  let parsed = buffer.parsed;
  if (buffer.revision !== revision) {
    parsed = parseBrief(content);
    setBuffer({ revision, parsed });
    if (removalUndo) setRemovalUndo(undefined);
  }

  const pending = new Set(pendingActions.map(briefActionKey));
  for (const action of submittingActions) pending.add(action);

  if (!parsed.ok) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <TriangleAlert className="size-5 text-amber-500" />
        <div className="text-sm font-medium">This brief file isn't valid</div>
        <div className="max-w-sm text-xs text-muted-foreground">{parsed.error}</div>
      </div>
    );
  }

  const brief = parsed.value;
  const spec = specState(brief);
  const plan = planState(brief, spec);
  const { openQuestions, unresolvedDecisions, settled } = spec;
  const specBlockerCount = openQuestions.length + unresolvedDecisions.length;
  const executionPending = planExecuting(plan, {
    requested: pending.has("execute-plan"),
    ownerActive,
  });
  const reviewPending = pending.has("review-outcome");
  const planActionPending = executionPending || reviewPending;
  const canRunAction = editable && Boolean(onRunAction);
  const planComplete = Boolean(plan?.fullyPlanned && plan.status === "complete");
  const canStartExecution = Boolean(canRunAction && plan?.canExecute && !planActionPending);
  const canReviewOutcome = canRunAction && planComplete && !planActionPending;
  const reviewAction = reviewPending ? "Outcome review in progress" : "Review outcome";
  const executionAction = reviewPending
    ? "Outcome review in progress"
    : executionPending
      ? "Plan execution in progress"
      : !settled
        ? `${specBlockerCount} thing${specBlockerCount === 1 ? "" : "s"} to settle before executing`
        : !plan?.fullyPlanned
          ? "Plan needs attention"
          : plan.status === "in-progress"
            ? "Resume execution"
            : "Execute plan";
  const tabs = resolveBriefTabs(brief);
  const activeTab = tabs.find((tab) =>
    tab.sections.some((section) => section.id === selectedTabSectionId),
  ) ??
    tabs[0] ?? { title: brief.title, sections: brief.sections };
  const visibleSections = activeTab.sections;
  const firstVisiblePlanSectionId = visibleSections.find((section) => section.kind === "plan")?.id;
  const allSectionsCollapsed = visibleSections.every(
    (section) => !briefSectionIsOpen(editable, sectionOpenById, section.id, section.collapsed),
  );
  const disclosureAction = allSectionsCollapsed ? "Expand all" : "Collapse all";
  const selectedEntity = selectedEntityId ? findBriefEntity(brief, selectedEntityId) : undefined;

  function persist(next: BriefDocument) {
    if (next === brief) return;
    setBuffer({ revision, parsed: { ok: true, value: next } });
    onContentChange(serializeBrief(next));
  }

  function commit(next: BriefDocument, undo?: RemovalUndo) {
    if (next === brief) return;
    setRemovalUndo(undo);
    persist(next);
  }

  /** Remove one entity with undo; the model owns which removals are valid. */
  function remove(entityId: BriefEntityId) {
    const entity = findBriefEntity(brief, entityId);
    const next = removeEntity(brief, entityId);
    if (!entity || next === brief) return;
    if (entityId === selectedEntityId) clearFocusedEntity();
    const label =
      entity.type === "section"
        ? `${entity.label} section`
        : entity.type === "finding"
          ? `finding: ${entity.label}`
          : entity.label;
    commit(next, { previousDocument: brief, label });
  }

  function undoRemoval() {
    if (!removalUndo) return;
    commit(removalUndo.previousDocument);
  }

  /** Save an inspector edit only when it still applies and leaves a valid brief. */
  function saveEdit(edit: BriefEdit): string | undefined {
    const next = edit(brief);
    if (next === brief) return "This is no longer part of the brief.";
    const validated = parseBrief(serializeBrief(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function inspectEntity(entityId: BriefEntityId) {
    setSelectedEntityId(entityId);
    setInspectorOpen(true);
  }

  function clearFocusedEntity() {
    setInspectorOpen(false);
    setSelectedEntityId(undefined);
  }

  function setAllSectionsOpen(open: boolean) {
    if (editable) {
      persist(
        setSectionsCollapsed(
          brief,
          visibleSections.map((section) => section.id),
          !open,
        ),
      );
      return;
    }
    setSectionOpenById((current) => ({
      ...current,
      ...Object.fromEntries(visibleSections.map((section) => [section.id, open])),
    }));
  }

  function setSectionOpen(sectionId: string, open: boolean) {
    if (editable) {
      persist(setSectionsCollapsed(brief, [sectionId], !open));
      return;
    }
    setSectionOpenById((current) =>
      current[sectionId] === open ? current : { ...current, [sectionId]: open },
    );
  }

  function changeRecordsView(sectionId: string, view: RecordsView) {
    if (editable) {
      persist(setRecordsView(brief, sectionId, view));
      return;
    }
    setRecordsViewById((current) =>
      current[sectionId] === view ? current : { ...current, [sectionId]: view },
    );
  }

  function navigateToSection(sectionId: string) {
    const section = brief.sections.find((candidate) => candidate.id === sectionId);
    if (!section) return;
    if (!briefSectionIsOpen(editable, sectionOpenById, section.id, section.collapsed)) {
      setSectionOpen(section.id, true);
    }
    document
      .getElementById(briefSectionElementId(section.id))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function dispatch(request: BriefAction) {
    const key = briefActionKey(request);
    if (!onRunAction || pending.has(key)) return;
    setActionFailed(false);
    setSubmittingActions((current) => new Set(current).add(key));
    actionMutation.mutate(request);
  }

  return (
    <ScrollableFade axis="vertical" rootClassName="h-full bg-background">
      <div className={cn("mx-auto max-w-6xl space-y-3.5", compact ? "p-3" : "p-5")}>
        <header className="px-1 pb-1">
          <h1 className="text-lg font-semibold">{brief.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <BriefTabPicker tabs={tabs} activeTab={activeTab} onSelect={setSelectedTabSectionId} />
            <BriefTableOfContents sections={visibleSections} onNavigate={navigateToSection} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={disclosureAction}
                    onClick={() => setAllSectionsOpen(allSectionsCollapsed)}
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {allSectionsCollapsed ? (
                      <ChevronsUpDown aria-hidden className="size-3.5" />
                    ) : (
                      <ChevronsDownUp aria-hidden className="size-3.5" />
                    )}
                  </button>
                }
              />
              <TooltipContent sideOffset={6}>{disclosureAction}</TooltipContent>
            </Tooltip>
            {plan &&
              (planComplete ? (
                <>
                  <Check
                    role="img"
                    aria-label="Plan complete"
                    className="size-4 text-emerald-400"
                  />
                  {canRunAction && (
                    <button
                      type="button"
                      aria-label={reviewAction}
                      title={reviewAction}
                      disabled={!canReviewOutcome}
                      onClick={() => dispatch({ action: "review-outcome" })}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reviewPending ? (
                        <RunningIndicator className="size-3.5" />
                      ) : (
                        <SearchCheck aria-hidden className="size-3.5" />
                      )}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  aria-label={executionAction}
                  title={executionAction}
                  disabled={!canStartExecution}
                  onClick={() => dispatch({ action: "execute-plan" })}
                  className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {planActionPending ? (
                    <RunningIndicator className="size-3.5" />
                  ) : (
                    <Play aria-hidden className="size-3.5 fill-current" />
                  )}
                </button>
              ))}
            {specBlockerCount > 0 && (
              <span className="ml-auto text-[11px] font-medium text-rose-400">
                {openQuestions.length > 0
                  ? `${openQuestions.length} question${openQuestions.length === 1 ? "" : "s"}`
                  : ""}
                {openQuestions.length > 0 && unresolvedDecisions.length > 0 ? " and " : ""}
                {unresolvedDecisions.length > 0
                  ? `${unresolvedDecisions.length} choice${unresolvedDecisions.length === 1 ? "" : "s"}`
                  : ""}
                {` still ${specBlockerCount === 1 ? "needs" : "need"} you`}
              </span>
            )}
            {selectedEntity && (
              <div
                role="status"
                className="flex max-w-fit items-center gap-1.5 rounded-md bg-sky-500/8 px-2 py-1 text-[10.5px]"
              >
                <span className="text-muted-foreground">Focused on</span>
                <button
                  type="button"
                  onClick={() => setInspectorOpen(true)}
                  className="inline-flex min-w-0 items-center gap-1 font-medium text-sky-300 hover:underline"
                >
                  <PanelRightOpen className="size-3 shrink-0" />
                  <span className="truncate">{selectedEntity.label}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Stop following ${selectedEntity.label}`}
                  title="Stop following"
                  onClick={clearFocusedEntity}
                  className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
          </div>
          {actionFailed && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Unable to start that action. Try again.
            </p>
          )}
        </header>

        {removalUndo && (
          <div
            role="status"
            className="mx-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[10.5px] text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">Removed {removalUndo.label} from brief.</span>
            <button
              type="button"
              onClick={undoRemoval}
              className="shrink-0 font-medium text-foreground hover:underline"
            >
              Undo
            </button>
          </div>
        )}

        {visibleSections.map((section) => {
          const regenerable = canRegenerateSection(section);
          return (
            <SectionPanel
              key={section.id}
              id={briefSectionElementId(section.id)}
              title={section.title}
              purpose={section.purpose}
              count={countSectionItems(brief, section)}
              open={briefSectionIsOpen(editable, sectionOpenById, section.id, section.collapsed)}
              onOpenChange={(open) => setSectionOpen(section.id, open)}
              actions={
                editable || regenerable
                  ? {
                      regenerate: regenerable
                        ? {
                            busy: pending.has(
                              briefActionKey({
                                action: "regenerate-section",
                                sectionId: section.id,
                              }),
                            ),
                            onSelect: canRunAction
                              ? () =>
                                  dispatch({ action: "regenerate-section", sectionId: section.id })
                              : undefined,
                          }
                        : undefined,
                      onDelete:
                        editable && canRemoveEntity(brief, section.id)
                          ? () => remove(section.id)
                          : undefined,
                    }
                  : undefined
              }
            >
              {section.kind === "plan" ? (
                plan && (
                  <PlanContent
                    spec={spec}
                    plan={plan}
                    section={section}
                    showPlanSummary={section.id === firstVisiblePlanSectionId}
                    focusedEntityId={selectedEntityId}
                    onInspect={inspectEntity}
                  />
                )
              ) : (
                <SectionContent
                  document={brief}
                  section={section}
                  editable={editable}
                  baseUri={baseUri}
                  pending={pending}
                  focusedEntityId={selectedEntityId}
                  recordsView={editable ? undefined : recordsViewById[section.id]}
                  onInspect={inspectEntity}
                  onExplainRecord={
                    canRunAction
                      ? (recordId) => dispatch({ action: "explain-record", recordId })
                      : undefined
                  }
                  onRemove={editable ? remove : undefined}
                  onInvestigateQuestion={
                    canRunAction
                      ? (questionId) => dispatch({ action: "investigate-question", questionId })
                      : undefined
                  }
                  onEdit={(edit) => commit(edit(brief))}
                  onRecordsViewChange={changeRecordsView}
                />
              )}
            </SectionPanel>
          );
        })}
      </div>
      <EntityInspector
        document={brief}
        baseUri={baseUri}
        entity={inspectorOpen ? selectedEntity : undefined}
        pending={pending}
        onClose={() => setInspectorOpen(false)}
        onInspect={inspectEntity}
        onExplainRecord={
          canRunAction ? (recordId) => dispatch({ action: "explain-record", recordId }) : undefined
        }
        onSave={editable ? saveEdit : undefined}
        onRemove={editable ? remove : undefined}
      />
    </ScrollableFade>
  );
}
