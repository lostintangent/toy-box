// Broadcast plane for the shared /api/workspace stream. Unlike the
// session event bus, this has no cursor or replay; consumers heal missed
// updates from the authoritative workspace snapshot.

import type { WorkspaceEvent } from "@workspace/model/events";
import type { SessionMetadataUpdate } from "@sessions/model";
import { sharedSet } from "@/shared/server/processState";

type WorkspaceEventListener = (event: WorkspaceEvent) => void;

const workspaceEventListeners = sharedSet<WorkspaceEventListener>("workspace-events.listeners");

/** Publish one accepted transition without coupling producers to individual clients. */
export function broadcast(event: WorkspaceEvent): void {
  for (const listener of [...workspaceEventListeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("Failed to broadcast workspace event:", error);
    }
  }
}

export function emitSessionUpsert(session: SessionMetadataUpdate): void {
  broadcast({ type: "session.upserted", session });
}

export function emitSessionDelete(sessionId: string): void {
  broadcast({ type: "session.deleted", sessionId });
}

export function emitSessionNameUpdate(sessionId: string, name: string): void {
  emitSessionUpsert({
    sessionId,
    summary: name,
  });
}

export function emitSessionTouched(sessionId: string): void {
  broadcast({ type: "session.touched", sessionId });
}

export function subscribeWorkspaceEvents(listener: WorkspaceEventListener): () => void {
  workspaceEventListeners.add(listener);
  return () => {
    workspaceEventListeners.delete(listener);
  };
}
