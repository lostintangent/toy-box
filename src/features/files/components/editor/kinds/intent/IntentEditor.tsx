import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
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
} from "@/shared/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import type { EditorProps } from "../index";
import {
  findFindingsSection,
  findRecordsSection,
  findIntentEntity,
  parseIntent,
  planSections,
  planState,
  recordLabel,
  resolveIntentTabs,
  specState,
  serializeIntent,
  type Finding,
  type FindingUpdate,
  type IntentDocument,
  type IntentEntityId,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type IntentRecord,
  type IntentRecordUpdate,
  type OptionAddition,
  type PlanStep,
  type PlanStepUpdate,
  type RecordsView,
  type ResolvedIntentTab,
} from "./model/index";
import {
  canRegenerateSection,
  selectDecisionOption,
  clearDecisionChoice,
  recordDecision,
  removeExhibit,
  removeFinding,
  removeSection,
  removeRecord,
  reopenDecision,
  reopenQuestion,
  setRecordsView,
  setSectionCollapsed,
  setSectionsCollapsed,
  updateExhibit,
  updateFinding,
  updateRecord,
  updatePlanStep,
} from "./model/edit";
import { IntentEntityInspector } from "./inspector";
import {
  countSectionItems,
  IntentPlanSection,
  IntentSectionContent,
  SectionPanel,
} from "./sections";

const INTENT_ACTION_NAMES = {
  "regenerate-section": "Regenerate a section",
  "investigate-question": "Answer an open question",
  "explain-record": "Explain a record",
  "execute-plan": "Execute the plan",
  "review-outcome": "Review the outcome",
} as const;

type IntentAction = keyof typeof INTENT_ACTION_NAMES;
type IntentWorkerAction =
  | { action: "regenerate-section"; sectionId: string }
  | { action: "investigate-question"; questionId: string }
  | { action: "explain-record"; recordId: string }
  | { action: "execute-plan" }
  | { action: "review-outcome" };
type RemovalUndo = {
  previousDocument: IntentDocument;
  label: string;
};

const CONTENTS_CLOSE_DELAY_MS = 120;

function intentSectionElementId(sectionId: string): string {
  return `intent-section-${sectionId}`;
}

function intentSectionIsOpen(
  editable: boolean,
  sectionOpenById: Readonly<Record<string, boolean>>,
  sectionId: string,
  collapsed: boolean,
): boolean {
  return editable ? !collapsed : (sectionOpenById[sectionId] ?? !collapsed);
}

function IntentTableOfContents({
  sections,
  onNavigate,
}: {
  sections: IntentDocument["sections"];
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
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Table of contents"
          onPointerEnter={openFromPointer}
          onPointerLeave={scheduleClose}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <TableOfContents aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-64 p-1.5"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onOpenAutoFocus={(event) => {
          if (openedByPointerRef.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <nav aria-label="Intent sections">
          <ol className="space-y-0.5">
            {sections.map((section, index) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-controls={intentSectionElementId(section.id)}
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

function IntentTabPicker({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: ResolvedIntentTab[];
  activeTab: ResolvedIntentTab;
  onSelect: (sectionId: string) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Intent tab: ${activeTab.title}`}
          className="inline-flex h-8 max-w-52 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <span className="truncate">{activeTab.title}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-40"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {tabs.map((tab) => {
          const anchor = tab.sections[0];
          if (!anchor) return null;
          const active = tab === activeTab;
          return (
            <DropdownMenuItem
              key={anchor.id}
              aria-current={active ? "page" : undefined}
              className="text-xs"
              onSelect={() => onSelect(anchor.id)}
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

function isIntentAction(value: unknown): value is IntentAction {
  return typeof value === "string" && Object.hasOwn(INTENT_ACTION_NAMES, value);
}

function intentActionTarget(request: IntentWorkerAction): string | undefined {
  if (request.action === "regenerate-section") return request.sectionId;
  if (request.action === "investigate-question") return request.questionId;
  if (request.action === "explain-record") return request.recordId;
}

function intentActionKey(request: IntentWorkerAction): string {
  const target = intentActionTarget(request);
  return target ? `${request.action}:${target}` : request.action;
}

function intentActionName(request: IntentWorkerAction): string {
  const name = INTENT_ACTION_NAMES[request.action];
  const target = intentActionTarget(request);
  return target ? `${name}: ${target}`.slice(0, 100) : name;
}

function intentWorkerAction(value: unknown): IntentWorkerAction | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const intent = Reflect.get(value, "intent");
  if (typeof intent !== "object" || intent === null || Array.isArray(intent)) return;
  const action = Reflect.get(intent, "action");
  if (!isIntentAction(action)) return;
  if (action === "execute-plan" || action === "review-outcome") return { action };
  if (action === "regenerate-section") {
    const sectionId = Reflect.get(intent, "sectionId");
    return typeof sectionId === "string" ? { action, sectionId } : undefined;
  }
  if (action === "investigate-question") {
    const questionId = Reflect.get(intent, "questionId");
    return typeof questionId === "string" ? { action, questionId } : undefined;
  }
  const recordId = Reflect.get(intent, "recordId");
  return typeof recordId === "string" ? { action, recordId } : undefined;
}

function pendingIntentActions(workers: EditorProps["pendingWorkers"]): Set<string> {
  const actions = new Set<string>();
  for (const worker of workers) {
    const intent = intentWorkerAction(worker.metadata);
    if (intent) actions.add(intentActionKey(intent));
  }
  return actions;
}

export function intentWorkerPrompt(request: IntentWorkerAction): string {
  if (request.action === "execute-plan") {
    return "Use the registered `execute-toy-box-intent` skill to execute or resume this intent's plan.";
  }
  if (request.action === "review-outcome") {
    return "Use the registered `execute-toy-box-intent` skill's post-execution workflow to review this completed intent's outcome.";
  }
  const targetInstruction =
    request.action === "regenerate-section"
      ? ` for section "${request.sectionId}"`
      : request.action === "investigate-question"
        ? ` for question "${request.questionId}"`
        : request.action === "explain-record"
          ? ` for record "${request.recordId}"`
          : "";
  return `Use the registered \`create-toy-box-intent\` skill's \`${request.action}\` editor-action workflow${targetInstruction}.`;
}

export function IntentEditor({
  mode,
  variant,
  baseUri,
  file,
  pendingWorkers,
  spawnWorker,
}: EditorProps) {
  const editable = mode !== "read";
  const [buffer, setBuffer] = useState(() => ({
    revision: file.revision,
    parsed: parseIntent(file.content ?? ""),
  }));
  const [removalUndo, setRemovalUndo] = useState<RemovalUndo>();
  const [sectionOpenById, setSectionOpenById] = useState<Readonly<Record<string, boolean>>>({});
  const [recordsViewById, setRecordsViewById] = useState<Readonly<Record<string, RecordsView>>>({});
  const [selectedTabSectionId, setSelectedTabSectionId] = useState<string>();
  const [selectedEntityId, setSelectedEntityId] = useState<IntentEntityId>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [submittingActions, setSubmittingActions] = useState<ReadonlySet<string>>(() => new Set());
  const [spawnFailed, setSpawnFailed] = useState(false);
  const spawnMutation = useMutation({
    mutationFn: (request: IntentWorkerAction) => {
      if (!spawnWorker) {
        return Promise.reject(new Error("Background workers aren't available for this file."));
      }
      return spawnWorker({
        name: intentActionName(request),
        prompt: intentWorkerPrompt(request),
        metadata: { intent: request },
      });
    },
    onError: () => setSpawnFailed(true),
    onSettled: (_data, _error, request) => {
      const key = intentActionKey(request);
      setSubmittingActions((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    },
  });

  let parsed = buffer.parsed;
  if (buffer.revision !== file.revision) {
    parsed = parseIntent(file.content ?? "");
    setBuffer({ revision: file.revision, parsed });
    if (removalUndo) setRemovalUndo(undefined);
  }

  const pending = pendingIntentActions(pendingWorkers);
  for (const action of submittingActions) pending.add(action);

  if (!parsed.ok) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <TriangleAlert className="size-5 text-amber-500" />
        <div className="text-sm font-medium">This intent file isn't valid</div>
        <div className="max-w-sm text-xs text-muted-foreground">{parsed.error}</div>
      </div>
    );
  }

  const intent = parsed.value;
  const spec = specState(intent);
  const plan = planState(planSections(intent), spec);
  const { openQuestions, unresolvedDecisions, settled } = spec;
  const specBlockerCount = openQuestions.length + unresolvedDecisions.length;
  const executionPending = pending.has("execute-plan");
  const reviewPending = pending.has("review-outcome");
  const planWorkerPending = executionPending || reviewPending;
  const canRunWorker = editable && Boolean(spawnWorker);
  const planComplete = Boolean(plan?.fullyPlanned && plan.status === "complete");
  const canStartExecution = Boolean(canRunWorker && plan?.canExecute && !planWorkerPending);
  const canReviewOutcome = canRunWorker && planComplete && !planWorkerPending;
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
  const tabs = resolveIntentTabs(intent);
  const activeTab = tabs.find((tab) =>
    tab.sections.some((section) => section.id === selectedTabSectionId),
  ) ??
    tabs[0] ?? { title: intent.title, sections: intent.sections };
  const visibleSections = activeTab.sections;
  const firstVisiblePlanSectionId = visibleSections.find((section) => section.kind === "plan")?.id;
  const allSectionsCollapsed = visibleSections.every(
    (section) => !intentSectionIsOpen(editable, sectionOpenById, section.id, section.collapsed),
  );
  const disclosureAction = allSectionsCollapsed ? "Expand all" : "Collapse all";
  const selectedEntity = selectedEntityId ? findIntentEntity(intent, selectedEntityId) : undefined;
  const selectedExhibitCanBeRemoved =
    editable &&
    selectedEntity?.type === "exhibit" &&
    selectedEntity.owner.kind === "section" &&
    removeExhibit(intent, selectedEntity.owner.section.id, selectedEntity.id) !== intent;
  const selectedFindingCanBeRemoved =
    editable &&
    selectedEntity?.type === "finding" &&
    removeFinding(intent, selectedEntity.section.id, selectedEntity.id) !== intent;

  function persist(next: IntentDocument) {
    if (next === intent) return;
    setBuffer({ revision: file.revision, parsed: { ok: true, value: next } });
    file.save(serializeIntent(next));
    void file.flush();
  }

  function commit(next: IntentDocument, undo?: RemovalUndo) {
    if (next === intent) return;
    setRemovalUndo(undo);
    persist(next);
  }

  function deleteRecord(sectionId: string, recordId: string) {
    const section = findRecordsSection(intent, sectionId);
    const record = section?.items.find((candidate) => candidate.id === recordId);
    if (!record || record.change !== "new") return;
    const next = removeRecord(intent, sectionId, recordId);
    if (next === intent) return;
    commit(next, { previousDocument: intent, label: recordLabel(record) });
  }

  function deleteSection(sectionId: string) {
    const entity = findIntentEntity(intent, sectionId);
    if (entity?.type !== "section") return;
    const next = removeSection(intent, sectionId);
    if (next === intent) return;
    commit(next, { previousDocument: intent, label: `${entity.label} section` });
  }

  function deleteExhibit(sectionId: string, exhibitId: string) {
    const entity = findIntentEntity(intent, exhibitId);
    if (
      entity?.type !== "exhibit" ||
      entity.owner.kind !== "section" ||
      entity.owner.section.id !== sectionId ||
      entity.exhibit.change !== "new"
    ) {
      return;
    }
    const next = removeExhibit(intent, sectionId, exhibitId);
    if (next === intent) return;
    setInspectorOpen(false);
    setSelectedEntityId(undefined);
    commit(next, { previousDocument: intent, label: entity.label });
  }

  function deleteFinding(sectionId: string, findingId: string) {
    const section = findFindingsSection(intent, sectionId);
    const finding = section?.items.find((candidate) => candidate.id === findingId);
    if (!finding) return;
    const next = removeFinding(intent, sectionId, findingId);
    if (next === intent) return;
    setInspectorOpen(false);
    setSelectedEntityId(undefined);
    commit(next, { previousDocument: intent, label: `finding: ${finding.statement}` });
  }

  function undoRemoval() {
    if (!removalUndo) return;
    commit(removalUndo.previousDocument);
  }

  function saveRecord(
    recordId: string,
    update: IntentRecordUpdate,
    original: IntentRecord | OptionAddition,
  ): string | undefined {
    const current = findIntentEntity(intent, recordId);
    if (current?.type !== "record") {
      return "This record is no longer part of the intent.";
    }
    if (JSON.stringify(current.record) !== JSON.stringify(original)) {
      return "This record changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updateRecord(intent, recordId, update);
    if (next === intent) return "This record is no longer part of the intent.";
    const validated = parseIntent(serializeIntent(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function saveExhibit(
    exhibitId: string,
    update: IntentExhibitUpdate,
    original: IntentExhibit,
  ): string | undefined {
    const current = findIntentEntity(intent, exhibitId);
    if (current?.type !== "exhibit") {
      return "This exhibit is no longer part of the intent.";
    }
    if (JSON.stringify(current.exhibit) !== JSON.stringify(original)) {
      return "This exhibit changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updateExhibit(intent, exhibitId, update);
    if (next === intent) return "This exhibit is no longer part of the intent.";
    const validated = parseIntent(serializeIntent(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function saveFinding(
    findingId: string,
    update: FindingUpdate,
    original: Finding,
  ): string | undefined {
    const current = findIntentEntity(intent, findingId);
    if (current?.type !== "finding") {
      return "This finding is no longer part of the intent.";
    }
    if (JSON.stringify(current.finding) !== JSON.stringify(original)) {
      return "This finding changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updateFinding(intent, findingId, update);
    if (next === intent) return "This finding is no longer part of the intent.";
    const validated = parseIntent(serializeIntent(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function savePlanStep(
    stepId: string,
    update: PlanStepUpdate,
    original: PlanStep,
  ): string | undefined {
    const current = findIntentEntity(intent, stepId);
    if (current?.type !== "plan-step") {
      return "This plan step is no longer part of the intent.";
    }
    if (JSON.stringify(current.step) !== JSON.stringify(original)) {
      return "This plan step changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updatePlanStep(intent, stepId, update);
    if (next === intent) return "This plan step is no longer part of the intent.";
    const validated = parseIntent(serializeIntent(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function inspectEntity(entityId: IntentEntityId) {
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
          intent,
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
      persist(setSectionCollapsed(intent, sectionId, !open));
      return;
    }
    setSectionOpenById((current) =>
      current[sectionId] === open ? current : { ...current, [sectionId]: open },
    );
  }

  function changeRecordsView(sectionId: string, view: RecordsView) {
    if (editable) {
      persist(setRecordsView(intent, sectionId, view));
      return;
    }
    setRecordsViewById((current) =>
      current[sectionId] === view ? current : { ...current, [sectionId]: view },
    );
  }

  function navigateToSection(sectionId: string) {
    const section = intent.sections.find((candidate) => candidate.id === sectionId);
    if (!section) return;
    if (!intentSectionIsOpen(editable, sectionOpenById, section.id, section.collapsed)) {
      setSectionOpen(section.id, true);
    }
    document
      .getElementById(intentSectionElementId(section.id))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function dispatch(request: IntentWorkerAction) {
    const key = intentActionKey(request);
    if (!spawnWorker || pending.has(key)) return;
    setSpawnFailed(false);
    setSubmittingActions((current) => new Set(current).add(key));
    spawnMutation.mutate(request);
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className={cn("mx-auto max-w-6xl space-y-3.5", variant === "compact" ? "p-3" : "p-5")}>
        <header className="px-1 pb-1">
          <h1 className="text-lg font-semibold">{intent.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <IntentTabPicker tabs={tabs} activeTab={activeTab} onSelect={setSelectedTabSectionId} />
            <IntentTableOfContents sections={visibleSections} onNavigate={navigateToSection} />
            <Tooltip>
              <TooltipTrigger asChild>
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
              </TooltipTrigger>
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
                  {canRunWorker && (
                    <button
                      type="button"
                      aria-label={reviewAction}
                      title={reviewAction}
                      disabled={!canReviewOutcome}
                      onClick={() => dispatch({ action: "review-outcome" })}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reviewPending ? (
                        <Loader2 aria-hidden className="size-3.5 animate-spin" />
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
                  {planWorkerPending ? (
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
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
          {spawnFailed && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Unable to start that worker. Try again.
            </p>
          )}
        </header>

        {removalUndo && (
          <div
            role="status"
            className="mx-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[10.5px] text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              Removed {removalUndo.label} from intent.
            </span>
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
              id={intentSectionElementId(section.id)}
              title={section.title}
              purpose={section.purpose}
              count={countSectionItems(intent, section)}
              open={intentSectionIsOpen(editable, sectionOpenById, section.id, section.collapsed)}
              onOpenChange={(open) => setSectionOpen(section.id, open)}
              actions={
                editable || regenerable
                  ? {
                      regenerate: regenerable
                        ? {
                            busy: pending.has(`regenerate-section:${section.id}`),
                            onSelect: canRunWorker
                              ? () =>
                                  dispatch({ action: "regenerate-section", sectionId: section.id })
                              : undefined,
                          }
                        : undefined,
                      onDelete:
                        editable && intent.sections.length > 1
                          ? () => deleteSection(section.id)
                          : undefined,
                    }
                  : undefined
              }
            >
              <IntentSectionContent
                document={intent}
                section={section}
                editable={editable}
                baseUri={baseUri}
                pending={pending}
                focusedEntityId={selectedEntityId}
                recordsViewById={editable ? undefined : recordsViewById}
                renderPlan={(planSection) =>
                  plan ? (
                    <IntentPlanSection
                      spec={spec}
                      plan={plan}
                      section={planSection}
                      showPlanSummary={planSection.id === firstVisiblePlanSectionId}
                      focusedEntityId={selectedEntityId}
                      onInspect={inspectEntity}
                    />
                  ) : null
                }
                onInspect={inspectEntity}
                onExplainRecord={
                  canRunWorker
                    ? (recordId) => dispatch({ action: "explain-record", recordId })
                    : undefined
                }
                onRemoveRecord={editable ? deleteRecord : undefined}
                onInvestigateQuestion={
                  canRunWorker
                    ? (questionId) => dispatch({ action: "investigate-question", questionId })
                    : undefined
                }
                onSelectDecisionOption={(decisionId, optionId) =>
                  commit(selectDecisionOption(intent, decisionId, optionId))
                }
                onRecordDecision={(decisionId) => commit(recordDecision(intent, decisionId))}
                onReopenDecision={(decisionId) => commit(reopenDecision(intent, decisionId))}
                onClearDecisionChoice={(decisionId) =>
                  commit(clearDecisionChoice(intent, decisionId))
                }
                onReopenQuestion={(questionId) => commit(reopenQuestion(intent, questionId))}
                onRecordsViewChange={changeRecordsView}
              />
            </SectionPanel>
          );
        })}
      </div>
      <IntentEntityInspector
        document={intent}
        baseUri={baseUri}
        entity={inspectorOpen ? selectedEntity : undefined}
        pending={pending}
        onClose={() => setInspectorOpen(false)}
        onInspect={inspectEntity}
        onExplainRecord={
          canRunWorker ? (recordId) => dispatch({ action: "explain-record", recordId }) : undefined
        }
        onRemoveExhibit={selectedExhibitCanBeRemoved ? deleteExhibit : undefined}
        onRemoveFinding={selectedFindingCanBeRemoved ? deleteFinding : undefined}
        onUpdateExhibit={editable ? saveExhibit : undefined}
        onUpdateFinding={editable ? saveFinding : undefined}
        onUpdateRecord={editable ? saveRecord : undefined}
        onUpdatePlanStep={editable ? savePlanStep : undefined}
      />
    </div>
  );
}
