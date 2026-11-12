import { areSettingsEqual, DEFAULT_SETTINGS, type Settings } from "../config/settings";
import type { WorkspaceEvent } from "../events";
import { sameSavedDraft, type DraftKey, type SavedDrafts } from "./drafts";

/** The complete shared workspace projection assembled by the server and reduced by clients. */
export type WorkspaceState = {
  settings: Settings;
  /** Each composer's unsent text, shared across clients. */
  drafts: SavedDrafts;
  environment: WorkspaceEnvironment;
};

/** Passive facts about the server process, fixed for its lifetime. */
export type WorkspaceEnvironment = {
  voiceEnabled: boolean;
  /** The machine's name, which this server is named after until it's renamed. */
  computerName: string;
};

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    settings: DEFAULT_SETTINGS,
    drafts: {},
    environment: { voiceEnabled: false, computerName: "" },
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "settings.changed":
      return areSettingsEqual(state.settings, event.settings)
        ? state
        : { ...state, settings: event.settings };
    case "session.deleted":
      return removeDraft(state, `session:${event.sessionId}`);
    case "channel.deleted":
      return removeDraft(state, `channel:${event.channelId}`);
    case "draft.changed":
      return sameSavedDraft(state.drafts[event.key], event.draft)
        ? state
        : { ...state, drafts: { ...state.drafts, [event.key]: event.draft } };
    case "session.upserted":
      return event.session.sessionType === "hyper" &&
        state.settings.hyperSessionId !== event.session.id
        ? { ...state, settings: { ...state.settings, hyperSessionId: event.session.id } }
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
