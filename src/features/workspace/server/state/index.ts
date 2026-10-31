// Authoritative server boundary for workspace-wide facts outside transcripts.

import type { Settings } from "../../model/config/settings";
import type { WorkspaceAction } from "../../model/state/actions";
import type { DraftKey } from "../../model/state/drafts";
import { areSettingsEqual, normalizeSettings } from "../../model/config/settings";
import type { WorkspaceState } from "../../model/state/reducer";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { broadcast } from "@workspace/server/events";
import { getEnvironment } from "./environment";
import { deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import { deleteSavedDraft, getSavedDrafts, saveDraft } from "./drafts";
import { getSettings, saveSettings } from "./settings";

/** Assemble the current projection of the shared facts workspace owns. */
export async function getWorkspaceState(): Promise<WorkspaceState> {
  return {
    settings: await getSettings(),
    drafts: getSavedDrafts(),
    hyperSessionIds: getHyperSessionIds(),
    environment: getEnvironment(),
  };
}

// The settings aggregate is persisted with a read-merge-write operation, so patches must not race.
const settingsChangeQueue = new SerialTaskQueue();

export function updateSettings(update: Partial<Settings>): Promise<Settings> {
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
  const current = await getSettings();
  const settings = normalizeSettings({ ...current, ...update });
  if (!areSettingsEqual(current, settings)) {
    await saveSettings(settings);
    broadcast({ type: "settings.changed", settings });
  }
  return settings;
}

export function deleteSessionWorkspaceState(sessionId: string): void {
  deleteSavedDraft(`session:${sessionId}`);
  deleteHyperState(sessionId);
}

/** Stamp a draft with server time, then broadcast it iff it changed. */
function commitDraft(key: DraftKey, text: string, origin: string): void {
  const draft = saveDraft(key, text, origin);
  if (draft) broadcast({ type: "draft.changed", key, draft });
}

export function applyWorkspaceAction(action: WorkspaceAction): void {
  switch (action.type) {
    case "draft.changed":
      commitDraft(action.key, action.draft.text, action.draft.origin);
      return;
    case "session.hyper.promoted":
      if (deleteHyperState(action.sessionId)) broadcast(action);
      return;
    default:
      action satisfies never;
  }
}
