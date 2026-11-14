// Authoritative server boundary for workspace-wide facts outside transcripts.

import type { Settings } from "../../model/config/settings";
import { areSettingsEqual, normalizeSettings } from "../../model/config/settings";
import type { DraftKey } from "../../model/state/drafts";
import type { WorkspaceState } from "../../model/state/reducer";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { broadcast } from "@workspace/server/events";
import { getInstalledVersion } from "../installation";
import { getEnvironment } from "./environment";
import { deleteSavedDraft, getSavedDrafts, saveDraft } from "./drafts";
import { getSettings, saveSettings } from "./settings";

/** Assemble the current projection of the shared facts workspace owns. */
export async function getWorkspaceState(): Promise<WorkspaceState> {
  return {
    settings: await getSettings(),
    drafts: getSavedDrafts(),
    environment: getEnvironment(),
    installedVersion: await getInstalledVersion(),
  };
}

// The settings aggregate is persisted with a read-merge-write operation, so patches must not race.
const settingsChangeQueue = new SerialTaskQueue();

export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return settingsChangeQueue.enqueue(() => commitSettingsChange(patch));
}

async function commitSettingsChange(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const settings = normalizeSettings({ ...current, ...patch });
  if (!areSettingsEqual(current, settings)) {
    await saveSettings(settings);
    broadcast({ type: "settings.changed", settings });
  }
  return settings;
}

/** Drops a deleted session's draft and the settings that reference it. */
export function deleteSessionWorkspaceState(sessionId: string): Promise<void> {
  deleteSavedDraft(`session:${sessionId}`);
  // Reading inside the queue keeps this read-filter-write from racing a pin toggle.
  return settingsChangeQueue.enqueue(async () => {
    const { pinnedSessionIds, hyperSessionId } = await getSettings();
    if (!pinnedSessionIds.includes(sessionId) && hyperSessionId !== sessionId) return;

    await commitSettingsChange({
      pinnedSessionIds: pinnedSessionIds.filter((pinnedId) => pinnedId !== sessionId),
      hyperSessionId: hyperSessionId === sessionId ? null : hyperSessionId,
    });
  });
}

/** Stamp a draft with server time, then broadcast it iff it changed. */
export function updateDraft(key: DraftKey, text: string, origin: string): void {
  const draft = saveDraft(key, text, origin);
  if (draft) broadcast({ type: "draft.changed", key, draft });
}
