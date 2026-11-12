import type { Settings } from "./config/settings";
import type { DraftKey, SavedDraft } from "./state/drafts";

/**
 * The events each feature publishes on the shared workspace stream, keyed by
 * feature folder. A feature adds its events by augmenting this interface from
 * its own model, so the stream never lists features by hand.
 */
export interface WorkspaceEvents {
  workspace:
    | { type: "draft.changed"; key: DraftKey; draft: SavedDraft }
    | { type: "workspace.connected"; revision: string; connection: string; version: string }
    | { type: "settings.changed"; settings: Settings };
}

/** One shared update broadcast from the server to every connected workspace. */
export type WorkspaceEvent = WorkspaceEvents[keyof WorkspaceEvents];
