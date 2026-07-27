import type {
  Automation,
  Worker,
  CustomEditorKind,
  DraftPrompt,
  InboxEntry,
  Settings,
  WorkspaceEvent,
} from "@/types";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";
import { areSettingsEqual, DEFAULT_SETTINGS } from "@/lib/workspace/config/settings";
import { isWorkerOwnedBySession } from "@/lib/files/workspaceFile";

/** The complete shared workspace projection assembled by the server and reduced by clients. */
export type WorkspaceState = {
  settings: Settings;
  sessionStates: Record<string, WorkspaceSessionState>;
  hyperSessionIds: string[];
  automations: Automation[];
  inboxEntries: InboxEntry[];
  workers: Worker[];
  customEditors: CustomEditorKind[];
  environment: WorkspaceEnvironment;
};

/** Passive capabilities configured by the server process. */
export type WorkspaceEnvironment = {
  terminalWsPort: number;
  voiceEnabled: boolean;
};

/**
 * Shared lifecycle and composer state for one session. Missing means idle.
 */
export type WorkspaceSessionState =
  | { status: "draft"; createdAt: number; prompt?: DraftPrompt; artifactPath?: string }
  | { status: "running" | "unread"; prompt?: DraftPrompt }
  | { status: "idle"; prompt: DraftPrompt };

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    settings: DEFAULT_SETTINGS,
    sessionStates: {},
    hyperSessionIds: [],
    automations: [],
    inboxEntries: [],
    workers: [],
    customEditors: [],
    environment: { terminalWsPort: DEFAULT_TERMINAL_WS_PORT, voiceEnabled: false },
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "settings.changed":
      return areSettingsEqual(state.settings, event.settings)
        ? state
        : { ...state, settings: event.settings };
    case "session.drafted": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      return event.hyper ? setHyperSessionMembership(next, event.sessionId, true) : next;
    }
    case "session.deleted": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      const withoutHyper = setHyperSessionMembership(next, event.sessionId, false);
      return removeWorkersForSession(withoutHyper, event.sessionId);
    }
    case "session.hyper.promoted":
      return setHyperSessionMembership(state, event.sessionId, false);
    case "session.prompt.drafted":
    case "session.running":
    case "session.idle":
    case "session.unread":
    case "session.read":
      return reduceSessionInWorkspace(state, event.sessionId, event);
    case "session.upserted":
      return state;
    case "inbox.entry.upserted":
      return upsertInboxEntry(state, event.entry);
    case "inbox.entry.deleted":
      return deleteInboxEntry(state, event.entryId);
    case "editor.registered":
      return registerEditorKind(state, event.kind);
    case "worker.started":
      return startWorker(state, event.worker);
    case "worker.finished":
      return finishWorker(state, event.sessionId);
    case "automation.upserted":
      return upsertAutomation(state, event.automation);
    case "automation.deleted":
      return deleteAutomation(state, event.automationId);
  }
}

export type WorkspaceSessionEvent = Extract<
  WorkspaceEvent,
  {
    type:
      | "session.drafted"
      | "session.prompt.drafted"
      | "session.running"
      | "session.idle"
      | "session.unread"
      | "session.read"
      | "session.deleted";
  }
>;

/** The canonical transition function shared by the server store and client projection. */
export function reduceWorkspaceSessionState(
  state: WorkspaceSessionState | undefined,
  event: WorkspaceSessionEvent,
): WorkspaceSessionState | undefined {
  switch (event.type) {
    case "session.drafted": {
      if (state?.status === "running" || state?.status === "unread") {
        return state;
      }
      if (
        state?.status === "draft" &&
        state.createdAt === event.createdAt &&
        state.artifactPath === event.artifactPath
      ) {
        return state;
      }
      return {
        status: "draft",
        createdAt: event.createdAt,
        prompt: state?.prompt,
        ...(event.artifactPath ? { artifactPath: event.artifactPath } : {}),
      };
    }
    case "session.prompt.drafted":
      if (state?.prompt && sameDraftPrompt(state.prompt, event.prompt)) return state;
      return state ? { ...state, prompt: event.prompt } : { status: "idle", prompt: event.prompt };
    case "session.running":
      return state?.status === "running"
        ? state
        : { status: "running", ...(state?.prompt ? { prompt: state.prompt } : {}) };
    case "session.idle":
      if (!state || state.status === "draft") return state;
      return idleSessionState(state.prompt);
    case "session.unread":
      return state?.status === "unread"
        ? state
        : { status: "unread", ...(state?.prompt ? { prompt: state.prompt } : {}) };
    case "session.read":
      return state?.status === "unread" ? idleSessionState(state.prompt) : state;
    case "session.deleted":
      return undefined;
  }
}

export function isWorkspaceSessionRunning(state: WorkspaceSessionState | undefined): boolean {
  return state?.status === "running";
}

function reduceSessionInWorkspace(
  workspace: WorkspaceState,
  sessionId: string,
  event: WorkspaceSessionEvent,
): WorkspaceState {
  const current = workspace.sessionStates[sessionId];
  const next = reduceWorkspaceSessionState(current, event);
  if (next === current) return workspace;

  if (!next) {
    if (!current) return workspace;
    const { [sessionId]: _, ...sessionStates } = workspace.sessionStates;
    return { ...workspace, sessionStates };
  }

  return {
    ...workspace,
    sessionStates: { ...workspace.sessionStates, [sessionId]: next },
  };
}

function idleSessionState(prompt?: DraftPrompt): WorkspaceSessionState | undefined {
  return prompt ? { status: "idle", prompt } : undefined;
}

function sameDraftPrompt(left: DraftPrompt, right: DraftPrompt): boolean {
  return (
    left.text === right.text && left.origin === right.origin && left.updatedAt === right.updatedAt
  );
}

function setHyperSessionMembership(
  state: WorkspaceState,
  sessionId: string,
  present: boolean,
): WorkspaceState {
  const hasSessionId = state.hyperSessionIds.includes(sessionId);
  if (present === hasSessionId) return state;

  return {
    ...state,
    hyperSessionIds: present
      ? [...state.hyperSessionIds, sessionId]
      : state.hyperSessionIds.filter((id) => id !== sessionId),
  };
}

function upsertInboxEntry(state: WorkspaceState, entry: InboxEntry): WorkspaceState {
  const index = state.inboxEntries.findIndex((existing) => existing.id === entry.id);
  if (index === -1) return { ...state, inboxEntries: [entry, ...state.inboxEntries] };
  if (state.inboxEntries[index] === entry) return state;

  const inboxEntries = [...state.inboxEntries];
  inboxEntries[index] = entry;
  return { ...state, inboxEntries };
}

function deleteInboxEntry(state: WorkspaceState, entryId: string): WorkspaceState {
  const inboxEntries = state.inboxEntries.filter((entry) => entry.id !== entryId);
  return inboxEntries.length === state.inboxEntries.length ? state : { ...state, inboxEntries };
}

function registerEditorKind(state: WorkspaceState, kind: CustomEditorKind): WorkspaceState {
  const index = state.customEditors.findIndex((current) => current.name === kind.name);
  if (index === -1) return { ...state, customEditors: [...state.customEditors, kind] };
  if (state.customEditors[index] === kind) return state;

  const customEditors = [...state.customEditors];
  customEditors[index] = kind;
  return { ...state, customEditors };
}

function startWorker(state: WorkspaceState, worker: Worker): WorkspaceState {
  if (state.workers.some((current) => current.sessionId === worker.sessionId)) return state;
  return { ...state, workers: [...state.workers, worker] };
}

function finishWorker(state: WorkspaceState, sessionId: string): WorkspaceState {
  const workers = state.workers.filter((worker) => worker.sessionId !== sessionId);
  return workers.length === state.workers.length ? state : { ...state, workers };
}

function removeWorkersForSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  const workers = state.workers.filter((worker) => !isWorkerOwnedBySession(worker, sessionId));
  return workers.length === state.workers.length ? state : { ...state, workers };
}

function upsertAutomation(state: WorkspaceState, automation: Automation): WorkspaceState {
  const index = state.automations.findIndex((current) => current.id === automation.id);
  if (index !== -1 && state.automations[index] === automation) return state;

  const automations = [...state.automations];
  if (index === -1) automations.push(automation);
  else automations[index] = automation;
  automations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { ...state, automations };
}

function deleteAutomation(state: WorkspaceState, automationId: string): WorkspaceState {
  const automations = state.automations.filter((automation) => automation.id !== automationId);
  return automations.length === state.automations.length ? state : { ...state, automations };
}
