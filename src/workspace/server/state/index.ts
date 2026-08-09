// Authoritative server boundary for workspace-wide facts outside transcripts.

import type { Settings } from "../../model/config/settings";
import type { WorkspaceAction } from "../../model/state/actions";
import type { DraftSession } from "@sessions/model";
import { finishWorkersForSession, getWorkers } from "@workers/server/registry";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@sessions/model/constants";
import { normalizeSettings } from "../../model/config/settings";
import {
  reduceWorkspaceSessionState,
  type WorkspaceSessionEvent,
  type WorkspaceState,
} from "../../model/state/reducer";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { broadcast } from "@workspace/server/events";
import { addHyperSession, deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import { applySessionState, getSessionState, getSessionStates, setSessionPrompt } from "./sessions";
import { getDraftSessions } from "@sessions/server/state/drafts";
import { getSettings, persistSettings } from "./settings";

export { getEnvironment } from "./environment";

export async function getWorkspaceState(
  options: Pick<
    WorkspaceState,
    | "automations"
    | "inboxEntries"
    | "customEditors"
    | "appDefinitions"
    | "apps"
    | "appShares"
    | "environment"
  >,
): Promise<WorkspaceState> {
  const [drafts, settings] = await Promise.all([getDraftSessions(), getSettings()]);
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
  finishWorkersForSession(sessionId);
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
