// Broadcast plane for the shared /api/events SSE stream. Unlike the session
// stream buffer, this has no cursor or replay; consumers heal missed
// updates by refetching their query cache.

import type {
  AutomationsUpdateEvent,
  DraftPrompt,
  DraftSession,
  SessionMetadataUpdate,
  WorkspaceEvent,
} from "@/types";
import { sharedSet } from "./processState";

const SESSION = "session" as const;

type BroadcastTopicListener<T> = (event: T) => void;
type WorkspaceEventListener = (event: WorkspaceEvent) => void;
type AutomationsUpdateListener = (event: AutomationsUpdateEvent) => void;

type BroadcastTopic<T> = {
  emit(event: T): void;
  subscribe(listener: BroadcastTopicListener<T>): () => void;
};

function createBroadcastTopic<T>(name: string): BroadcastTopic<T> {
  const listeners = sharedSet<BroadcastTopicListener<T>>(`${name}.listeners`);

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

const workspaceEvents = createBroadcastTopic<WorkspaceEvent>("session-events");
const automationUpdates = createBroadcastTopic<AutomationsUpdateEvent>("automation-events");

export function emitWorkspaceEvent(event: WorkspaceEvent): void {
  workspaceEvents.emit(event);
}

export function emitSessionUpsert(session: SessionMetadataUpdate): void {
  emitWorkspaceEvent({ type: `${SESSION}.upserted`, session });
}

export function emitSessionDelete(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.deleted`, sessionId });
}

export function emitSessionRunning(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.running`, sessionId });
}

export function emitSessionIdle(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.idle`, sessionId });
}

export function emitSessionUnread(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.unread`, sessionId });
}

export function emitSessionRead(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.read`, sessionId });
}

export function emitDraftCreated(draft: DraftSession): void {
  emitWorkspaceEvent({ type: `${SESSION}.draft.created`, draft });
}

export function emitDraftDiscarded(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.draft.discarded`, sessionId });
}

export function emitSessionHyper(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.hyper.created`, sessionId });
}

export function emitSessionPromoted(sessionId: string): void {
  emitWorkspaceEvent({ type: `${SESSION}.hyper.promoted`, sessionId });
}

export function emitDraftPromptChanged(sessionId: string, prompt: DraftPrompt): void {
  emitWorkspaceEvent({ type: `${SESSION}.prompt.drafted`, sessionId, prompt });
}

export function updateSessionName(sessionId: string, name: string): void {
  emitSessionUpsert({
    sessionId,
    summary: name,
  });
}

export function subscribeWorkspaceEvents(listener: WorkspaceEventListener): () => void {
  return workspaceEvents.subscribe(listener);
}

export function emitAutomationsUpdate(event: AutomationsUpdateEvent): void {
  automationUpdates.emit(event);
}

export function subscribeAutomationsUpdates(listener: AutomationsUpdateListener): () => void {
  return automationUpdates.subscribe(listener);
}
