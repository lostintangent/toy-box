// Server-side Workspace operations shared by validated ingress.

import { loadCustomEditors } from "@files/server/editors";
import { retainSessionSnapshots } from "@sessions/server/state/snapshots";
import { getWorkers } from "@workers/server/registry";
import type { Settings } from "../model/config/settings";
import type { WorkspaceState } from "../model/state/reducer";
import { applyWorkspaceAction, changeSettings } from "./state";
import { getEnvironment } from "./state/environment";
import { getHyperSessionIds } from "./state/hyperSessions";
import { getSessionStates } from "./state/sessions";
import { getSettings } from "./state/settings";

export { applyWorkspaceAction };

/** Assemble the current projection from each feature's authoritative facts. */
export async function getWorkspaceState(): Promise<WorkspaceState> {
  const [customEditors, settings] = await Promise.all([loadCustomEditors(), getSettings()]);
  return {
    settings,
    sessionStates: getSessionStates(),
    hyperSessionIds: getHyperSessionIds(),
    workers: getWorkers(),
    customEditors,
    environment: getEnvironment(),
  };
}

export async function updateSettings(update: Partial<Settings>): Promise<Settings> {
  const settings = await changeSettings(update);
  // Pinning is durable interest in a session, so its snapshot stays warm.
  // Warming runs past this operation rather than delaying the change.
  void retainSessionSnapshots(settings.pinnedSessionIds);
  return settings;
}
