import type { AppDefinition, AppInstance, AppShare } from "@apps/model";
import type { DraftPrompt } from "@sessions/model";
import type { Automation } from "@automations/model";
import type { CustomEditorKind } from "@files/model";
import type { InboxEntry } from "@inbox/model";
import { workerReferencesSession, type Worker } from "@workers/model";
import { areSettingsEqual, DEFAULT_SETTINGS, type Settings } from "../config/settings";
import type { WorkspaceEvent } from "../events";

/** The complete shared workspace projection assembled by the server and reduced by clients. */
export type WorkspaceState = {
  settings: Settings;
  sessionStates: Record<string, WorkspaceSessionState>;
  hyperSessionIds: string[];
  automations: Automation[];
  inboxEntries: InboxEntry[];
  workers: Worker[];
  customEditors: CustomEditorKind[];
  appDefinitions: AppDefinition[];
  apps: AppInstance[];
  appShares: AppShare[];
  environment: WorkspaceEnvironment;
};

/** Passive capabilities configured by the server process. */
export type WorkspaceEnvironment = {
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
    appDefinitions: [],
    apps: [],
    appShares: [],
    environment: { voiceEnabled: false },
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
      return updateList(withoutHyper, "workers", (workers) =>
        removeWhere(workers, (worker) => workerReferencesSession(worker, event.sessionId)),
      );
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
    case "session.touched":
      return state;
    case "inbox.entry.upserted":
      return updateList(state, "inboxEntries", (entries) =>
        upsertBy(entries, event.entry, "id", Object.is, (left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        ),
      );
    case "inbox.entry.deleted":
      return updateList(state, "inboxEntries", (entries) => removeBy(entries, "id", event.entryId));
    case "editor.registered":
      return updateList(state, "customEditors", (editors) => upsertBy(editors, event.kind, "name"));
    case "app.registered":
      return updateList(state, "appDefinitions", (definitions) =>
        upsertBy(
          definitions,
          event.definition,
          "id",
          (current, next) => current.revision === next.revision,
          (left, right) => left.title.localeCompare(right.title),
        ),
      );
    case "app.unregistered":
      return updateList(state, "appDefinitions", (definitions) =>
        removeBy(definitions, "id", event.definitionId),
      );
    case "app.upserted":
      return updateList(state, "apps", (apps) =>
        upsertBy(
          apps,
          event.app,
          "id",
          (current, next) => current.revision === next.revision,
          (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
        ),
      );
    case "app.deleted": {
      const withoutApp = updateList(state, "apps", (apps) => removeBy(apps, "id", event.appId));
      const withoutWorkers = updateList(withoutApp, "workers", (workers) =>
        removeWhere(workers, (worker) => worker.type === "app" && worker.appId === event.appId),
      );
      return updateList(withoutWorkers, "appShares", (shares) => {
        const retained = removeWhere(shares, (share) => share.targetAppId === event.appId);
        if (!retained.some((share) => share.sourceAppId === event.appId)) return retained;
        return retained.map((share) =>
          share.sourceAppId === event.appId ? { ...share, sourceAppId: null } : share,
        );
      });
    }
    case "app.share.created":
      return updateList(state, "appShares", (shares) =>
        upsertBy(shares, event.share, "id", Object.is, (left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        ),
      );
    case "app.share.deleted":
      return updateList(state, "appShares", (shares) => removeBy(shares, "id", event.shareId));
    case "worker.started":
      return updateList(state, "workers", (workers) =>
        workers.some((worker) => worker.sessionId === event.worker.sessionId)
          ? workers
          : [...workers, event.worker],
      );
    case "worker.finished":
      return updateList(state, "workers", (workers) =>
        removeBy(workers, "sessionId", event.sessionId),
      );
    case "automation.upserted":
      return updateList(state, "automations", (automations) =>
        upsertBy(automations, event.automation, "id", Object.is, (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
    case "automation.deleted":
      return updateList(state, "automations", (automations) =>
        removeBy(automations, "id", event.automationId),
      );
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

type WorkspaceListKey = {
  [Key in keyof WorkspaceState]: WorkspaceState[Key] extends unknown[] ? Key : never;
}[keyof WorkspaceState];

function updateList<Key extends WorkspaceListKey>(
  state: WorkspaceState,
  key: Key,
  update: (current: WorkspaceState[Key]) => WorkspaceState[Key],
): WorkspaceState {
  const current = state[key];
  const next = update(current);
  return next === current ? state : { ...state, [key]: next };
}

function upsertBy<Item, Key extends keyof Item>(
  items: Item[],
  item: Item,
  key: Key,
  equivalent: (current: Item, next: Item) => boolean = Object.is,
  compare?: (left: Item, right: Item) => number,
): Item[] {
  const index = items.findIndex((current) => Object.is(current[key], item[key]));
  if (index !== -1 && equivalent(items[index]!, item)) return items;

  const next = [...items];
  if (index === -1) next.push(item);
  else next[index] = item;
  if (compare) next.sort(compare);
  return next;
}

function removeBy<Item, Key extends keyof Item>(items: Item[], key: Key, value: Item[Key]): Item[] {
  return removeWhere(items, (item) => Object.is(item[key], value));
}

function removeWhere<Item>(items: Item[], remove: (item: Item) => boolean): Item[] {
  const next = items.filter((item) => !remove(item));
  return next.length === items.length ? items : next;
}
