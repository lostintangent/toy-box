// SSE pub/sub for session list updates.
//
// Every state module that needs to notify connected clients imports
// from here. This is the shared backbone of the real-time sync layer —
// listeners registered via subscribeSessionsUpdates receive every
// session.upserted, session.deleted, session.running, etc. event.

import type { SessionMetadataUpdate, SessionsUpdateEvent } from "@/types";
import { sharedSet } from "./processState";

const SESSION = "session" as const;

type SessionsUpdateListener = (event: SessionsUpdateEvent) => void;
const sessionsUpdateListeners = sharedSet<SessionsUpdateListener>("session-events.listeners");

export function emitSessionsUpdate(event: SessionsUpdateEvent): void {
  for (const listener of sessionsUpdateListeners) {
    listener(event);
  }
}

export function emitSessionUpsert(session: SessionMetadataUpdate): void {
  emitSessionsUpdate({ type: `${SESSION}.upserted`, session });
}

export function emitSessionDelete(sessionId: string): void {
  emitSessionsUpdate({ type: `${SESSION}.deleted`, sessionId });
}

export function emitSessionRunning(sessionId: string): void {
  emitSessionsUpdate({ type: `${SESSION}.running`, sessionId });
}

export function emitSessionIdle(sessionId: string): void {
  emitSessionsUpdate({ type: `${SESSION}.idle`, sessionId });
}

export function emitSessionUnread(sessionId: string): void {
  emitSessionsUpdate({ type: `${SESSION}.unread`, sessionId });
}

export function emitSessionRead(sessionId: string): void {
  emitSessionsUpdate({ type: `${SESSION}.read`, sessionId });
}

export function updateSessionSummary(
  sessionId: string,
  summary: string,
  options?: { replace?: boolean },
): void {
  emitSessionUpsert({
    sessionId,
    modifiedTime: new Date().toISOString(),
    summary,
    replaceSummary: options?.replace ?? false,
  });
}

export function subscribeSessionsUpdates(listener: SessionsUpdateListener): () => void {
  sessionsUpdateListeners.add(listener);
  return () => {
    sessionsUpdateListeners.delete(listener);
  };
}
