// Authoritative server boundary for workspace-wide facts outside transcripts.

import type {
  Automation,
  ArtifactWorker,
  CustomArtifactKind,
  DraftSession,
  InboxEntry,
  Settings,
  WorkspaceAction,
} from "@/types";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import { normalizeSettings } from "@/lib/workspace/config/settings";
import {
  reduceWorkspaceSessionState,
  type WorkspaceEnvironment,
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
import { writeCustomArtifact } from "./artifacts";
import { getSettings, persistSettings } from "./settings";
import {
  finishArtifactWorker as finishArtifactWorkerState,
  finishArtifactWorkersForSession,
  getArtifactWorker,
  getArtifactWorkers,
  hasArtifactWorker,
  startArtifactWorker as startArtifactWorkerState,
} from "./artifactWorkers";

export { loadCustomArtifacts, normalizeExtensions } from "./artifacts";
export { getEnvironment } from "./environment";

export async function getWorkspaceState(options: {
  automations: Automation[];
  customArtifacts: CustomArtifactKind[];
  environment: WorkspaceEnvironment;
}): Promise<WorkspaceState> {
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
    automations: options.automations,
    inboxEntries,
    artifactWorkers: getArtifactWorkers(),
    customArtifacts: options.customArtifacts,
    environment: options.environment,
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
  for (const workerSessionId of finishArtifactWorkersForSession(sessionId)) {
    broadcast({ type: "artifact.worker.finished", sessionId: workerSessionId });
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
  artifact?: { filename: string; content: string },
): Promise<InboxEntry> {
  const entry = await completeInboxEntry(sessionId, message, artifact);
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function deleteInboxEntry(entryId: string): Promise<boolean> {
  if (!(await hasInboxEntry(entryId))) return false;
  const deleted = await deleteInboxEntryState(entryId);
  if (deleted) broadcast({ type: "inbox.entry.deleted", entryId });
  return deleted;
}

export function startArtifactWorker(worker: ArtifactWorker): void {
  if (!startArtifactWorkerState(worker)) return;
  broadcast({ type: "artifact.worker.started", worker });
}

export function finishArtifactWorker(sessionId: string): void {
  if (!finishArtifactWorkerState(sessionId)) return;
  broadcast({ type: "artifact.worker.finished", sessionId });
}

export { getArtifactWorker, hasArtifactWorker };

export async function registerArtifactKind(kind: CustomArtifactKind): Promise<void> {
  await writeCustomArtifact(kind);
  broadcast({ type: "artifact.kind.registered", kind });
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
