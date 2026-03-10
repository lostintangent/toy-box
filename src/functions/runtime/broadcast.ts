// SSE pub/sub for session list updates.
//
// Every state module that needs to notify connected clients imports
// from here. This is the shared backbone of the real-time sync layer —
// listeners registered via subscribeSessionsUpdates receive every
// session.upserted, session.deleted, session.running, etc. event.

import type { SessionMetadataUpdate, SessionsUpdateEvent } from "@/types";

const SESSION = "session" as const;

type SessionsUpdateListener = (event: SessionsUpdateEvent) => void;
const sessionsUpdateListeners = new Set<SessionsUpdateListener>();

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

export function emitSessionTouched(
  sessionId: string,
  options?: {
    summary?: string;
    replaceSummary?: boolean;
  },
): void {
  const session: SessionMetadataUpdate = {
    sessionId,
    modifiedTime: new Date().toISOString(),
  };

  if (options?.summary !== undefined) {
    session.summary = options.summary;
  }
  if (options?.replaceSummary !== undefined) {
    session.replaceSummary = options.replaceSummary;
  }

  emitSessionUpsert(session);
}

export function updateSessionSummary(
  sessionId: string,
  summary: string,
  options?: { replace?: boolean },
): void {
  emitSessionTouched(sessionId, {
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
