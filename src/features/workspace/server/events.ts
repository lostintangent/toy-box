// Broadcast plane for the shared /api/workspace stream. Unlike the
// session event bus, this has no cursor or replay; consumers heal missed
// updates from the authoritative workspace snapshot.

import type { WorkspaceEvent } from "@workspace/model/events";
import { getProcessValue, sharedSet } from "@/shared/server/processState";

type WorkspaceEventListener = (event: WorkspaceEvent) => void;

const workspaceEventListeners = sharedSet<WorkspaceEventListener>("workspace-events.listeners");
const revision = getProcessValue("workspace-events.revision", () => ({
  epoch: crypto.randomUUID(),
  value: 0,
}));

/** Changes on every broadcast, survives HMR, and cannot match a previous server process. */
export function getWorkspaceRevision(): string {
  return `${revision.epoch}:${revision.value}`;
}

/** Publish one accepted transition without coupling producers to individual clients. */
export function broadcast(event: WorkspaceEvent): void {
  revision.value++;
  for (const listener of [...workspaceEventListeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("Failed to broadcast workspace event:", error);
    }
  }
}

export function subscribeWorkspaceEvents(listener: WorkspaceEventListener): () => void {
  workspaceEventListeners.add(listener);
  return () => {
    workspaceEventListeners.delete(listener);
  };
}
