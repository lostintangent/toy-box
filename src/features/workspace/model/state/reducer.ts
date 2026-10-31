import { areSettingsEqual, DEFAULT_SETTINGS, type Settings } from "../config/settings";
import type { WorkspaceEvent } from "../events";
import { sameSavedDraft, type DraftKey, type SavedDrafts } from "./drafts";

/** The complete shared workspace projection assembled by the server and reduced by clients. */
export type WorkspaceState = {
  settings: Settings;
  /** Each composer's unsent text, shared across clients. */
  drafts: SavedDrafts;
  hyperSessionIds: string[];
  environment: WorkspaceEnvironment;
};

/** Passive capabilities configured by the server process. */
export type WorkspaceEnvironment = {
  voiceEnabled: boolean;
};

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    settings: DEFAULT_SETTINGS,
    drafts: {},
    hyperSessionIds: [],
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
      const withoutHyper = setHyperSessionMembership(state, event.sessionId, false);
      return removeDraft(withoutHyper, `session:${event.sessionId}`);
    }
    case "channel.deleted":
      return removeDraft(state, `channel:${event.channelId}`);
    case "draft.changed":
      return sameSavedDraft(state.drafts[event.key], event.draft)
        ? state
        : { ...state, drafts: { ...state.drafts, [event.key]: event.draft } };
    case "session.hyper.promoted":
      return setHyperSessionMembership(state, event.sessionId, false);
    case "session.upserted":
      return event.session.sessionType === "hyper"
        ? setHyperSessionMembership(state, event.session.id, true)
        : state;
    default:
      return state;
  }
}

function removeDraft(state: WorkspaceState, key: DraftKey): WorkspaceState {
  if (!state.drafts[key]) return state;
  const { [key]: _, ...drafts } = state.drafts;
  return { ...state, drafts };
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
