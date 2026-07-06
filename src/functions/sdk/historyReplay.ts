// History replay — owns persisted log → Session, end to end. A log is
// replayed through the SAME streaming projection (projector.ts) and the same
// reducer that live sessions use, so a reloaded transcript can never
// disagree with the one a client watched stream in.
//
// Only one thin adaptation lives here: persisted histories can end without any
// event that the reducer treats as terminal, leaving transients such as status
// or pendingToolCalls populated. Replay appends one synthetic end after
// all real events so cold snapshots normalize the same way a completed client
// stream does.
//
// Everything else — turn starts, tool lifecycles, subagent nesting, todo SQL
// translation, committed user/assistant messages, omitted/translated/deferred
// tool policy — flows through projector.ts untouched.

import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import {
  applySessionEvent,
  createInitialSession,
  type Session,
} from "@/lib/session/sessionReducer";
import { createProjectionState, projectSdkEvent } from "./projector";

// ============================================================================
// Public API
// ============================================================================

/** The replay thesis as code: project the log through the shared SDK projector
 *  and let the canonical reducer build the final Session. */
export async function initializeSessionStateFromSdkHistory(
  sessionId: string,
  events: SdkSessionEvent[],
): Promise<Session> {
  const state = createInitialSession();
  const projectionState = createProjectionState(sessionId);

  for (const sdkEvent of events) {
    for (const sessionEvent of projectSdkEvent(sdkEvent, projectionState)) {
      applySessionEvent(state, sessionEvent);
    }
  }

  // Some persisted histories end without a reducer-visible terminal event.
  // Finalize reducer-only streaming state explicitly and idempotently after
  // replaying every real SDK event.
  applySessionEvent(state, { type: "end", reason: "idle" });
  return state;
}
