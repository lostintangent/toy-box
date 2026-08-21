import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  PanelRightOpen,
  Sparkles,
  TableOfContents,
  TriangleAlert,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import type { EditorProps } from "../index";
import {
  executionReadiness,
  findRecordsSection,
  findIntentEntity,
  parseIntent,
  recordLabel,
  sectionCanRefresh,
  sectionItemCount,
  serializeIntent,
  type IntentDefinition,
  type IntentEntityId,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type IntentRecord,
  type IntentRecordUpdate,
  type OptionAddition,
  type RecordsView,
  type WorkItem,
  type WorkItemUpdate,
} from "./model/index";
import { compareIntentToSavedVersion, saveIntentVersion } from "./model/checkpoints";
import {
  chooseOption,
  clearDecision,
  recordDecision,
  removeNewSharedItem,
  reopenDecision,
  reopenQuestion,
  setAllIntentSectionsCollapsed,
  setIntentRecordsView,
  setIntentSectionCollapsed,
  updateIntentExhibit,
  updateIntentRecord,
  updateIntentWork,
} from "./model/transitions";
import { IntentEntityInspector } from "./EntityInspector";
import {
  IntentMapSection,
  IntentSectionContent,
  IntentSequenceSection,
  SectionPanel,
} from "./sections";
import { IntentVersionControl } from "./VersionControl";

const INTENT_ACTION_NAMES = {
  "refresh-section": "Refresh a section",
  "investigate-question": "Answer an open question",
  "explain-item": "Explain an item",
  "start-work": "Start the work",
} as const;

type IntentAction = keyof typeof INTENT_ACTION_NAMES;
type IntentWorkerAction = { action: IntentAction; target?: string };
type RemovalUndo = { definition: IntentDefinition; sectionId: string; label: string };

const CONTENTS_CLOSE_DELAY_MS = 120;

function intentSectionElementId(sectionId: string): string {
  return `intent-section-${sectionId}`;
}

function intentSectionIsOpen(
  canMutate: boolean,
  sectionOpenById: Readonly<Record<string, boolean>>,
  sectionId: string,
  collapsed: boolean,
): boolean {
  return canMutate ? !collapsed : (sectionOpenById[sectionId] ?? !collapsed);
}

function IntentTableOfContents({
  sections,
  onNavigate,
}: {
  sections: IntentDefinition["sections"];
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

function isIntentAction(value: unknown): value is IntentAction {
  return typeof value === "string" && Object.hasOwn(INTENT_ACTION_NAMES, value);
}

function intentActionKey(action: IntentAction, target?: string): string {
  return target ? `${action}:${target}` : action;
}

function intentActionName({ action, target }: IntentWorkerAction): string {
  const name = INTENT_ACTION_NAMES[action];
  return target ? `${name}: ${target}`.slice(0, 100) : name;
}

function intentWorkerAction(value: unknown): IntentWorkerAction | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const intent = Reflect.get(value, "intent");
  if (typeof intent !== "object" || intent === null || Array.isArray(intent)) return;
  const action = Reflect.get(intent, "action");
  const target = Reflect.get(intent, "target");
  if (!isIntentAction(action) || (target !== undefined && typeof target !== "string")) return;
  return { action, ...(target !== undefined ? { target } : {}) };
}

function pendingIntentActions(workers: EditorProps["pendingWorkers"]): Set<string> {
  const actions = new Set<string>();
  for (const worker of workers) {
    const intent = intentWorkerAction(worker.metadata);
    if (intent) actions.add(intentActionKey(intent.action, intent.target));
  }
  return actions;
}

function workerPrompt({ action, target }: IntentWorkerAction): string {
  const targetInstruction =
    target === undefined
      ? ""
      : action === "refresh-section"
        ? ` for section "${target}"`
        : action === "investigate-question"
          ? ` for question "${target}"`
          : action === "explain-item"
            ? ` for item "${target}"`
            : "";
  return `Use the registered \`create-toy-box-intent\` skill's \`${action}\` file-worker workflow${targetInstruction}.`;
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
        prompt: workerPrompt(request),
        metadata: { intent: request },
      });
    },
    onError: () => setSpawnFailed(true),
    onSettled: (_data, _error, request) => {
      const key = intentActionKey(request.action, request.target);
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

  const definition = parsed.value;
  const execution = executionReadiness(definition);
  const { openQuestions, blockingDecisions, approvable } = execution.review;
  const blockerCount = openQuestions.length + blockingDecisions.length;
  const startPending = pending.has("start-work");
  const canMutate = editable;
  const canRunWorker = editable && Boolean(spawnWorker);
  const canStart = canRunWorker && execution.ready && !startPending;
  const versionComparison = compareIntentToSavedVersion(definition);
  const allSectionsCollapsed = definition.sections.every(
    (section) => !intentSectionIsOpen(canMutate, sectionOpenById, section.id, section.collapsed),
  );
  const disclosureAction = allSectionsCollapsed ? "Expand all" : "Collapse all";
  const selectedEntity = selectedEntityId
    ? findIntentEntity(definition, selectedEntityId)
    : undefined;

  function persist(next: IntentDefinition) {
    if (next === definition) return;
    setBuffer({ revision: file.revision, parsed: { ok: true, value: next } });
    file.save(serializeIntent(next));
    void file.flush();
  }

  function commit(next: IntentDefinition) {
    if (next === definition) return;
    setRemovalUndo(undefined);
    persist(next);
  }

  function removeItem(sectionId: string, itemId: string) {
    const section = findRecordsSection(definition, sectionId);
    const item = section?.items.find((candidate) => candidate.id === itemId);
    if (!item || item.change !== "new") return;
    const next = removeNewSharedItem(definition, sectionId, itemId);
    if (next === definition) return;
    setRemovalUndo({ definition, sectionId, label: recordLabel(item) });
    persist(next);
  }

  function undoRemoval() {
    if (!removalUndo) return;
    const previous = removalUndo.definition;
    setRemovalUndo(undefined);
    persist(previous);
  }

  function updateRecord(
    recordId: string,
    update: IntentRecordUpdate,
    original: IntentRecord | OptionAddition,
  ): string | undefined {
    const current = findIntentEntity(definition, recordId);
    if (current?.type !== "record") {
      return "This item is no longer part of the intent.";
    }
    if (JSON.stringify(current.record) !== JSON.stringify(original)) {
      return "This item changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updateIntentRecord(definition, recordId, update);
    if (next === definition) return "This item is no longer part of the intent.";
    const validated = parseIntent(serializeIntent(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function updateExhibit(
    exhibitId: string,
    update: IntentExhibitUpdate,
    original: IntentExhibit,
  ): string | undefined {
    const current = findIntentEntity(definition, exhibitId);
    if (current?.type !== "exhibit") {
      return "This exact detail is no longer part of the intent.";
    }
    if (JSON.stringify(current.exhibit) !== JSON.stringify(original)) {
      return "This exact detail changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updateIntentExhibit(definition, exhibitId, update);
    if (next === definition) return "This exact detail is no longer part of the intent.";
    const validated = parseIntent(serializeIntent(next));
    if (!validated.ok) return validated.error;
    commit(validated.value);
  }

  function updateWork(
    itemId: string,
    update: WorkItemUpdate,
    original: WorkItem,
  ): string | undefined {
    const current = findIntentEntity(definition, itemId);
    if (current?.type !== "work") {
      return "This work item is no longer part of the intent.";
    }
    if (JSON.stringify(current.work) !== JSON.stringify(original)) {
      return "This work item changed while you were editing. Cancel and reopen it to use the latest version.";
    }
    const next = updateIntentWork(definition, itemId, update);
    if (next === definition) return "This work item is no longer part of the intent.";
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
    if (canMutate) {
      persist(setAllIntentSectionsCollapsed(definition, !open));
      return;
    }
    setSectionOpenById(
      Object.fromEntries(definition.sections.map((section) => [section.id, open])),
    );
  }

  function setSectionOpen(sectionId: string, open: boolean) {
    if (canMutate) {
      persist(setIntentSectionCollapsed(definition, sectionId, !open));
      return;
    }
    setSectionOpenById((current) =>
      current[sectionId] === open ? current : { ...current, [sectionId]: open },
    );
  }

  function changeRecordsView(sectionId: string, view: RecordsView) {
    if (canMutate) {
      persist(setIntentRecordsView(definition, sectionId, view));
      return;
    }
    setRecordsViewById((current) =>
      current[sectionId] === view ? current : { ...current, [sectionId]: view },
    );
  }

  function navigateToSection(sectionId: string) {
    const section = definition.sections.find((candidate) => candidate.id === sectionId);
    if (!section) return;
    if (!intentSectionIsOpen(canMutate, sectionOpenById, section.id, section.collapsed)) {
      setSectionOpen(section.id, true);
    }
    document
      .getElementById(intentSectionElementId(section.id))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function dispatch(action: IntentAction, target?: string) {
    const request = { action, ...(target ? { target } : {}) };
    const key = intentActionKey(action, target);
    if (!spawnWorker || pending.has(key)) return;
    setSpawnFailed(false);
    setSubmittingActions((current) => new Set(current).add(key));
    spawnMutation.mutate(request);
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className={cn("mx-auto max-w-6xl space-y-3.5", variant === "compact" ? "p-3" : "p-5")}>
        <header className="px-1 pb-1">
          <h1 className="text-lg font-semibold">{definition.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <IntentTableOfContents sections={definition.sections} onNavigate={navigateToSection} />
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
            <IntentVersionControl
              comparison={versionComparison}
              focusedEntityId={selectedEntityId}
              onInspect={inspectEntity}
              onSaveVersion={
                canMutate
                  ? () => commit(saveIntentVersion(definition, new Date().toISOString()))
                  : undefined
              }
            />
            <button
              type="button"
              disabled={!canStart}
              onClick={() => dispatch("start-work")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold",
                canStart
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {startPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {startPending
                ? "Starting the work..."
                : !approvable
                  ? `${blockerCount} thing${blockerCount === 1 ? "" : "s"} to settle before starting`
                  : execution.delivery.present && !execution.delivery.complete
                    ? "Sequence needs attention"
                    : "Start work"}
            </button>
            {blockerCount > 0 && (
              <span
                className={cn(
                  "ml-auto text-[11px] font-medium",
                  blockerCount > 0 ? "text-rose-400" : "text-emerald-400",
                )}
              >
                {openQuestions.length > 0
                  ? `${openQuestions.length} question${openQuestions.length === 1 ? "" : "s"}`
                  : ""}
                {openQuestions.length > 0 && blockingDecisions.length > 0 ? " and " : ""}
                {blockingDecisions.length > 0
                  ? `${blockingDecisions.length} choice${blockingDecisions.length === 1 ? "" : "s"}`
                  : ""}
                {` still ${blockerCount === 1 ? "needs" : "need"} you`}
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
              Unable to start this work. Try again.
            </p>
          )}
        </header>

        {definition.sections.map((section) => {
          const refreshable = sectionCanRefresh(section);
          return (
            <SectionPanel
              key={section.id}
              id={intentSectionElementId(section.id)}
              title={section.title}
              purpose={section.purpose}
              count={sectionItemCount(definition, section)}
              open={intentSectionIsOpen(canMutate, sectionOpenById, section.id, section.collapsed)}
              onOpenChange={(open) => setSectionOpen(section.id, open)}
              refresh={
                refreshable
                  ? {
                      busy: pending.has(`refresh-section:${section.id}`),
                      onClick: canRunWorker
                        ? () => dispatch("refresh-section", section.id)
                        : undefined,
                    }
                  : undefined
              }
            >
              {section.kind === "map" ? (
                <IntentMapSection
                  definition={definition}
                  section={section}
                  focusedEntityId={selectedEntityId}
                  onInspect={inspectEntity}
                />
              ) : (
                <IntentSectionContent
                  definition={definition}
                  section={section}
                  editable={canMutate}
                  baseUri={baseUri}
                  pending={pending}
                  undoRemoval={removalUndo}
                  focusedEntityId={selectedEntityId}
                  recordsViewById={canMutate ? undefined : recordsViewById}
                  renderSequence={(sequence) => (
                    <IntentSequenceSection
                      definition={definition}
                      section={sequence}
                      focusedEntityId={selectedEntityId}
                      onInspect={inspectEntity}
                    />
                  )}
                  onInspect={inspectEntity}
                  onRefresh={
                    canRunWorker ? (sectionId) => dispatch("refresh-section", sectionId) : undefined
                  }
                  onExplain={
                    canRunWorker ? (itemId) => dispatch("explain-item", itemId) : undefined
                  }
                  onRemove={canMutate ? removeItem : undefined}
                  onUndoRemoval={canMutate ? undoRemoval : undefined}
                  onInvestigate={
                    canRunWorker
                      ? (questionId) => dispatch("investigate-question", questionId)
                      : undefined
                  }
                  onChoose={(decisionId, optionId) =>
                    commit(chooseOption(definition, decisionId, optionId))
                  }
                  onRecord={(decisionId) => commit(recordDecision(definition, decisionId))}
                  onReopenDecision={(decisionId) => commit(reopenDecision(definition, decisionId))}
                  onClear={(decisionId) => commit(clearDecision(definition, decisionId))}
                  onReopenQuestion={(questionId) => commit(reopenQuestion(definition, questionId))}
                  onRecordsViewChange={changeRecordsView}
                />
              )}
            </SectionPanel>
          );
        })}
      </div>
      <IntentEntityInspector
        definition={definition}
        baseUri={baseUri}
        entity={inspectorOpen ? selectedEntity : undefined}
        pending={pending}
        onClose={() => setInspectorOpen(false)}
        onInspect={inspectEntity}
        onExplain={canRunWorker ? (itemId) => dispatch("explain-item", itemId) : undefined}
        onUpdateExhibit={canMutate ? updateExhibit : undefined}
        onUpdateRecord={canMutate ? updateRecord : undefined}
        onUpdateWork={canMutate ? updateWork : undefined}
      />
    </div>
  );
}
