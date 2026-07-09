// Persisted SDK history → reduced Session. History and live events share the
// same stateful projector and canonical reducer; replay only adds the terminal
// end event that clears transient turn state from an otherwise complete log.

import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import {
  applySessionEvent,
  createInitialSession,
  type Session,
} from "@/lib/session/sessionReducer";
import { createSdkEventProjector } from "./projector";

/** Rebuild one session from its persisted SDK event log. */
export function replaySdkHistory(sessionId: string, events: SdkSessionEvent[]): Session {
  let session = createInitialSession();
  const projectSdkEvent = createSdkEventProjector(sessionId);

  for (const sdkEvent of events) {
    for (const sessionEvent of projectSdkEvent(sdkEvent)) {
      session = applySessionEvent(session, sessionEvent);
    }
  }

  // Some persisted histories end without a reducer-visible terminal event.
  // Finalize reducer-only streaming state explicitly and idempotently after
  // replaying every real SDK event.
  session = applySessionEvent(session, { type: "end", reason: "idle" });
  return session;
}
