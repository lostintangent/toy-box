import type { DraftPrompt } from "@sessions/model";
import type { CustomEditorKind } from "@files/model";
import { workerReferencesSession, type Worker } from "@workers/model";
import { areSettingsEqual, DEFAULT_SETTINGS, type Settings } from "../config/settings";
import type { WorkspaceEvent } from "../events";

/** The complete shared workspace projection assembled by the server and reduced by clients. */
export type WorkspaceState = {
  settings: Settings;
  sessionStates: Record<string, WorkspaceSessionState>;
  hyperSessionIds: string[];
  workers: Worker[];
  customEditors: CustomEditorKind[];
  environment: WorkspaceEnvironment;
};

/** Passive capabilities configured by the server process. */
export type WorkspaceEnvironment = {
  voiceEnabled: boolean;
};

/**
 * Shared lifecycle and composer state for one session. Missing means idle.
 * A live session remembers `since`, when its current run began.
 */
export type WorkspaceSessionState =
  | { status: "running" | "waiting"; since: number; prompt?: DraftPrompt }
  | { status: "unread"; prompt?: DraftPrompt }
  | { status: "idle"; prompt: DraftPrompt };

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    settings: DEFAULT_SETTINGS,
    sessionStates: {},
    hyperSessionIds: [],
    workers: [],
    customEditors: [],
    environment: { voiceEnabled: false },
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "settings.changed":
      return areSettingsEqual(state.settings, event.settings)
        ? state
        : { ...state, settings: event.settings };
    case "session.deleted": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      const withoutHyper = setHyperSessionMembership(next, event.sessionId, false);
      return removeWorkers(withoutHyper, (worker) =>
        workerReferencesSession(worker, event.sessionId),
      );
    }
    case "session.hyper.promoted":
      return setHyperSessionMembership(state, event.sessionId, false);
    case "session.prompt.drafted":
    case "session.running":
    case "session.waiting":
    case "session.idle":
    case "session.unread":
    case "session.read":
      return reduceSessionInWorkspace(state, event.sessionId, event);
    case "session.upserted":
      return event.session.sessionType === "hyper"
        ? setHyperSessionMembership(state, event.session.id, true)
        : state;
    case "editor.registered": {
      const index = state.customEditors.findIndex((kind) => kind.name === event.kind.name);
      if (state.customEditors[index] === event.kind) return state;
      const customEditors = [...state.customEditors];
      if (index === -1) customEditors.push(event.kind);
      else customEditors[index] = event.kind;
      return { ...state, customEditors };
    }
    case "app.deleted":
      return removeWorkers(
        state,
        (worker) => worker.type === "app" && worker.appId === event.appId,
      );
    case "worker.started":
      return state.workers.some((worker) => worker.sessionId === event.worker.sessionId)
        ? state
        : { ...state, workers: [...state.workers, event.worker] };
    case "worker.finished":
      return removeWorkers(state, (worker) => worker.sessionId === event.sessionId);
    default:
      return state;
  }
}

export type WorkspaceSessionEvent = Extract<
  WorkspaceEvent,
  {
    type:
      | "session.prompt.drafted"
      | "session.running"
      | "session.waiting"
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
    case "session.prompt.drafted":
      if (state?.prompt && sameDraftPrompt(state.prompt, event.prompt)) return state;
      return state ? { ...state, prompt: event.prompt } : { status: "idle", prompt: event.prompt };
    case "session.running":
    case "session.waiting": {
      const status = event.type === "session.running" ? "running" : "waiting";
      if (state?.status === status) return state;
      // Waiting is a pause within the same run, so moving between the live states keeps its start.
      const since =
        state?.status === "running" || state?.status === "waiting" ? state.since : event.at;
      return { status, since, ...(state?.prompt ? { prompt: state.prompt } : {}) };
    }
    case "session.idle":
      if (!state) return state;
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

export function isWorkspaceSessionLive(
  status: WorkspaceSessionState["status"] | undefined,
): boolean {
  return status === "running" || status === "waiting";
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

function removeWorkers(state: WorkspaceState, remove: (worker: Worker) => boolean): WorkspaceState {
  const workers = state.workers.filter((worker) => !remove(worker));
  return workers.length === state.workers.length ? state : { ...state, workers };
}
