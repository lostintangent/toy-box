import { workspaceFileId } from "@/lib/files/workspaceFile";
import type { Worker } from "@/types";

export function workerOwnerId(worker: Worker): string {
  switch (worker.type) {
    case "session":
      return `session:${worker.parentSessionId}`;
    case "file":
      return workspaceFileId(worker.file);
    case "app":
      return `app:${worker.appId}`;
  }
}

export function workerParentSessionId(worker: Worker): string | undefined {
  switch (worker.type) {
    case "session":
      return worker.parentSessionId;
    case "file":
      return worker.file.sessionId;
    case "app":
      return;
  }
}

/** Whether this is the worker's session or the session that directly parents it. */
export function workerReferencesSession(worker: Worker, sessionId: string): boolean {
  return worker.sessionId === sessionId || workerParentSessionId(worker) === sessionId;
}
