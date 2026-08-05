// Authoritative server boundary for workspace-wide facts outside transcripts.

import type {
  Worker,
  CustomEditorKind,
  DraftSession,
  InboxEntry,
  Settings,
  WorkspaceAction,
} from "@/types";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import { normalizeSettings } from "@/lib/workspace/config/settings";
import {
  reduceWorkspaceSessionState,
  type WorkspaceSessionEvent,
  type WorkspaceState,
} from "@/lib/workspace/state/reducer";
import { SerialTaskQueue } from "@/lib/serialTaskQueue";
import { broadcast } from "@/functions/runtime/broadcast";
import { addHyperSession, deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import {
  completeInboxEntry,
  createInboxEntry,
  deleteInboxEntryState,
  getInboxEntries,
  hasInboxEntry,
} from "./inbox";
import { applySessionState, getSessionState, getSessionStates, setSessionPrompt } from "./sessions";
import { getDraftSessions } from "../session/drafts";
import { writeCustomEditor } from "./editors";
import { getSettings, persistSettings } from "./settings";
import {
  finishWorker as finishWorkerState,
  finishWorkersForApp,
  finishWorkersForSession,
  getWorker,
  getWorkers,
  hasWorker,
  startWorker as startWorkerState,
} from "./workers";

export { loadCustomEditors, normalizeExtensions } from "./editors";
export { getEnvironment } from "./environment";

export async function getWorkspaceState(
  options: Pick<
    WorkspaceState,
    "automations" | "customEditors" | "appDefinitions" | "apps" | "appShares" | "environment"
  >,
): Promise<WorkspaceState> {
  const [drafts, inboxEntries, settings] = await Promise.all([
    getDraftSessions(),
    getInboxEntries(),
    getSettings(),
  ]);
  const sessionStates = getSessionStates();
  for (const draft of drafts) {
    const state = reduceWorkspaceSessionState(sessionStates[draft.sessionId], {
      type: "session.drafted",
      ...draft,
    });
    if (state) sessionStates[draft.sessionId] = state;
  }
  return {
    settings,
    sessionStates,
    hyperSessionIds: getHyperSessionIds(),
    inboxEntries,
    workers: getWorkers(),
    ...options,
  };
}

// The settings aggregate is persisted with a read-merge-write operation, so patches must not race.
const settingsChangeQueue = new SerialTaskQueue();

export function changeSettings(update: Partial<Settings>): Promise<Settings> {
  return settingsChangeQueue.enqueue(() => commitSettingsChange(update));
}

/** Drops a deleted session from the settings that reference it. */
export function unpinSession(sessionId: string): Promise<void> {
  // Reading inside the queue keeps this read-filter-write from racing a pin toggle.
  return settingsChangeQueue.enqueue(async () => {
    const { pinnedSessionIds } = await getSettings();
    if (!pinnedSessionIds.includes(sessionId)) return;

    await commitSettingsChange({
      pinnedSessionIds: pinnedSessionIds.filter((pinnedId) => pinnedId !== sessionId),
    });
  });
}

async function commitSettingsChange(update: Partial<Settings>): Promise<Settings> {
  const settings = normalizeSettings({ ...(await getSettings()), ...update });
  if (await persistSettings(settings)) {
    broadcast({ type: "settings.changed", settings });
  }
  return settings;
}

export function addDraftSession(draft: DraftSession, hyper?: true): void {
  const event = {
    type: "session.drafted",
    ...draft,
    ...(hyper ? { hyper } : {}),
  } as const;
  const changed = applySessionState(event);
  const hyperChanged = hyper ? addHyperSession(draft.sessionId) : false;
  if (changed || hyperChanged) broadcast(event);
}

export function deleteSessionWorkspaceState(sessionId: string): void {
  applySessionState({ type: "session.deleted", sessionId });
  deleteHyperState(sessionId);
  for (const workerSessionId of finishWorkersForSession(sessionId)) {
    broadcast({ type: "worker.finished", sessionId: workerSessionId });
  }
}

/**
 * Server twin of the client's applyWorkspaceEvent for the process-local
 * sessionStates map: reduce the transition in, then broadcast it only if the
 * reducer accepted it.
 */
function commitSessionEvent(event: WorkspaceSessionEvent): boolean {
  if (!applySessionState(event)) return false;
  broadcast(event);
  return true;
}

/** Derive the canonical prompt (server timestamp, text dedupe), then broadcast iff it changed. */
function commitSessionPrompt(sessionId: string, text: string, origin: string): void {
  const prompt = setSessionPrompt(sessionId, text, origin);
  if (prompt) broadcast({ type: "session.prompt.drafted", sessionId, prompt });
}

export function setSessionStatus(sessionId: string, status: "running" | "idle" | "unread"): void {
  commitSessionEvent({ type: `session.${status}`, sessionId } as const);
}

export function clearDraftPrompt(sessionId: string): void {
  if (!getSessionState(sessionId)?.prompt?.text) return;
  commitSessionPrompt(sessionId, "", DRAFT_PROMPT_SERVER_ORIGIN);
}

export async function createPendingInboxEntry(sessionId: string): Promise<InboxEntry> {
  const entry = await createInboxEntry(sessionId);
  setSessionStatus(sessionId, "running");
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function sendToInbox(
  sessionId: string,
  message: string,
  artifactFilename?: string,
): Promise<InboxEntry> {
  const entry = await completeInboxEntry(sessionId, message, artifactFilename);
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function deleteInboxEntry(entryId: string): Promise<boolean> {
  if (!(await hasInboxEntry(entryId))) return false;
  const deleted = await deleteInboxEntryState(entryId);
  if (deleted) broadcast({ type: "inbox.entry.deleted", entryId });
  return deleted;
}

export function startWorker(worker: Worker): void {
  if (!startWorkerState(worker)) return;
  broadcast({ type: "worker.started", worker });
}

export function finishWorker(sessionId: string): void {
  if (!finishWorkerState(sessionId)) return;
  broadcast({ type: "worker.finished", sessionId });
}

export function finishAppWorkers(appId: string): string[] {
  const sessionIds = finishWorkersForApp(appId);
  for (const sessionId of sessionIds) broadcast({ type: "worker.finished", sessionId });
  return sessionIds;
}

export { getWorker, hasWorker };

export async function registerEditorKind(kind: CustomEditorKind): Promise<void> {
  await writeCustomEditor(kind);
  broadcast({ type: "editor.registered", kind });
}

export function applyWorkspaceAction(action: WorkspaceAction): void {
  switch (action.type) {
    case "session.prompt.drafted":
      commitSessionPrompt(action.sessionId, action.prompt.text, action.prompt.origin);
      return;
    case "session.hyper.promoted":
      if (deleteHyperState(action.sessionId)) broadcast(action);
      return;
    case "session.read":
      commitSessionEvent(action);
      return;
    default:
      action satisfies never;
  }
}
