import type {
  Automation,
  ArtifactWorker,
  CustomArtifactKind,
  DraftPrompt,
  InboxEntry,
  Settings,
  WorkspaceEvent,
} from "@/types";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";
import { areSettingsEqual, DEFAULT_SETTINGS } from "@/lib/workspace/config/settings";

/** The complete shared workspace projection assembled by the server and reduced by clients. */
export type WorkspaceState = {
  settings: Settings;
  sessionStates: Record<string, WorkspaceSessionState>;
  hyperSessionIds: string[];
  automations: Automation[];
  inboxEntries: InboxEntry[];
  artifactWorkers: ArtifactWorker[];
  customArtifacts: CustomArtifactKind[];
  environment: WorkspaceEnvironment;
};

/** Passive capabilities configured by the server process. */
export type WorkspaceEnvironment = {
  terminalWsPort: number;
  voiceEnabled: boolean;
};

/**
 * Shared lifecycle and composer state for one session. Missing means idle.
 * `creating` remains draft-backed while also counting as running to activity UI.
 */
export type WorkspaceSessionState =
  | { status: "draft" | "creating"; createdAt: number; prompt?: DraftPrompt }
  | { status: "running" | "unread"; prompt?: DraftPrompt }
  | { status: "idle"; prompt: DraftPrompt };

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    settings: DEFAULT_SETTINGS,
    sessionStates: {},
    hyperSessionIds: [],
    automations: [],
    inboxEntries: [],
    artifactWorkers: [],
    customArtifacts: [],
    environment: { terminalWsPort: DEFAULT_TERMINAL_WS_PORT, voiceEnabled: false },
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "settings.changed":
      return areSettingsEqual(state.settings, event.settings)
        ? state
        : { ...state, settings: event.settings };
    case "session.draft.created": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      return event.hyper ? setHyperSessionMembership(next, event.sessionId, true) : next;
    }
    case "session.draft.discarded": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      return setHyperSessionMembership(next, event.sessionId, false);
    }
    case "session.deleted": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      const withoutHyper = setHyperSessionMembership(next, event.sessionId, false);
      return removeArtifactWorkersForSession(withoutHyper, event.sessionId);
    }
    case "session.hyper.promoted":
      return setHyperSessionMembership(state, event.sessionId, false);
    case "session.prompt.drafted":
    case "session.creating":
    case "session.running":
    case "session.idle":
    case "session.unread":
    case "session.read":
      return reduceSessionInWorkspace(state, event.sessionId, event);
    case "session.upserted":
      return reduceSessionInWorkspace(state, event.session.sessionId, event);
    case "inbox.entry.upserted":
      return upsertInboxEntry(state, event.entry);
    case "inbox.entry.deleted":
      return deleteInboxEntry(state, event.entryId);
    case "artifact.kind.registered":
      return registerArtifactKind(state, event.kind);
    case "artifact.worker.started":
      return startArtifactWorker(state, event.worker);
    case "artifact.worker.finished":
      return finishArtifactWorker(state, event.sessionId);
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
      | "session.draft.created"
      | "session.draft.discarded"
      | "session.prompt.drafted"
      | "session.creating"
      | "session.running"
      | "session.idle"
      | "session.unread"
      | "session.read"
      | "session.upserted"
      | "session.deleted";
  }
>;

/** The canonical transition function shared by the server store and client projection. */
export function reduceWorkspaceSessionState(
  state: WorkspaceSessionState | undefined,
  event: WorkspaceSessionEvent,
): WorkspaceSessionState | undefined {
  switch (event.type) {
    case "session.draft.created":
      if (
        state?.status === "creating" ||
        state?.status === "running" ||
        state?.status === "unread"
      ) {
        return state;
      }
      if (state?.status === "draft" && state.createdAt === event.createdAt) {
        return state;
      }
      return {
        status: "draft",
        createdAt: event.createdAt,
        prompt: state?.prompt,
      };
    case "session.draft.discarded":
      return state?.status === "draft" ? undefined : state;
    case "session.prompt.drafted":
      if (state?.prompt && sameDraftPrompt(state.prompt, event.prompt)) return state;
      return state ? { ...state, prompt: event.prompt } : { status: "idle", prompt: event.prompt };
    case "session.creating":
      if (state?.status !== "draft") return state;
      return { ...state, status: "creating" };
    case "session.running":
      return state?.status === "running"
        ? state
        : { status: "running", ...(state?.prompt ? { prompt: state.prompt } : {}) };
    case "session.idle":
      if (!state || state.status === "draft") return state;
      if (state.status === "creating") return { ...state, status: "draft" };
      return idleSessionState(state.prompt);
    case "session.unread":
      return state?.status === "unread"
        ? state
        : { status: "unread", ...(state?.prompt ? { prompt: state.prompt } : {}) };
    case "session.read":
      return state?.status === "unread" ? idleSessionState(state.prompt) : state;
    case "session.upserted":
      if (state?.status === "draft" || state?.status === "creating") {
        return { status: "running", ...(state.prompt ? { prompt: state.prompt } : {}) };
      }
      return state;
    case "session.deleted":
      return undefined;
  }
}

export function isWorkspaceSessionRunning(state: WorkspaceSessionState | undefined): boolean {
  return state?.status === "creating" || state?.status === "running";
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

function registerArtifactKind(state: WorkspaceState, kind: CustomArtifactKind): WorkspaceState {
  const index = state.customArtifacts.findIndex((current) => current.name === kind.name);
  if (index === -1) return { ...state, customArtifacts: [...state.customArtifacts, kind] };
  if (state.customArtifacts[index] === kind) return state;

  const customArtifacts = [...state.customArtifacts];
  customArtifacts[index] = kind;
  return { ...state, customArtifacts };
}

function startArtifactWorker(state: WorkspaceState, worker: ArtifactWorker): WorkspaceState {
  if (state.artifactWorkers.some((current) => current.sessionId === worker.sessionId)) return state;
  return { ...state, artifactWorkers: [...state.artifactWorkers, worker] };
}

function finishArtifactWorker(state: WorkspaceState, sessionId: string): WorkspaceState {
  const artifactWorkers = state.artifactWorkers.filter((worker) => worker.sessionId !== sessionId);
  return artifactWorkers.length === state.artifactWorkers.length
    ? state
    : { ...state, artifactWorkers };
}

function removeArtifactWorkersForSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  const artifactWorkers = state.artifactWorkers.filter(
    (worker) => worker.sourceSessionId !== sessionId && worker.sessionId !== sessionId,
  );
  return artifactWorkers.length === state.artifactWorkers.length
    ? state
    : { ...state, artifactWorkers };
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
