// Broadcast plane for the shared /api/events SSE stream. Unlike the session
// event bus, this has no cursor or replay; consumers heal missed
// updates from authoritative snapshots or query refetches.

import type { AutomationEvent, SessionMetadataUpdate, WorkspaceEvent } from "@/types";
import { sharedSet } from "./processState";

type Listener<T> = (event: T) => void;

type Topic<T> = {
  emit(event: T): void;
  subscribe(listener: Listener<T>): () => void;
};

function createTopic<T>(name: string): Topic<T> {
  const listeners = sharedSet<Listener<T>>(`${name}.listeners`);

  return {
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const workspaceEvents = createTopic<WorkspaceEvent>("workspace-events");
const automationEvents = createTopic<AutomationEvent>("automation-events");

/** Broadcast the event a transition produced, or nothing when it was a no-op (null). */
export function broadcast(event: WorkspaceEvent | null): void {
  if (event) workspaceEvents.emit(event);
}

export function emitSessionUpsert(session: SessionMetadataUpdate): void {
  workspaceEvents.emit({ type: "session.upserted", session });
}

export function emitSessionDelete(sessionId: string): void {
  workspaceEvents.emit({ type: "session.deleted", sessionId });
}

export function emitSessionNameUpdate(sessionId: string, name: string): void {
  emitSessionUpsert({
    sessionId,
    summary: name,
  });
}

export function subscribeWorkspaceEvents(listener: Listener<WorkspaceEvent>): () => void {
  return workspaceEvents.subscribe(listener);
}

export function emitAutomationEvent(event: AutomationEvent): void {
  automationEvents.emit(event);
}

export function subscribeAutomationEvents(listener: Listener<AutomationEvent>): () => void {
  return automationEvents.subscribe(listener);
}
