import type { SessionCanvas } from "@/types";

export type SessionOpenAction = "attach-stream" | "catch-up-unread" | "none";

export function resolveSessionOpenAction({
  isSessionRunning,
  isSessionActive,
  hasQueuedMessages,
  isSessionUnread,
  unreadCatchupDone,
}: {
  isSessionRunning: boolean;
  isSessionActive: boolean;
  hasQueuedMessages: boolean;
  isSessionUnread: boolean;
  unreadCatchupDone: boolean;
}): SessionOpenAction {
  if (isSessionRunning || isSessionActive || hasQueuedMessages) {
    return "attach-stream";
  }
  if (isSessionUnread && !unreadCatchupDone) {
    return "catch-up-unread";
  }
  return "none";
}

export type LinkedPanePublishState =
  | { linkedSessionIds: string[]; canvases: SessionCanvas[] }
  | undefined;

export function shouldLoadSessionSnapshot({
  isDraft,
  isStreaming,
  isDraftStatusLoading,
}: {
  isDraft: boolean;
  isStreaming: boolean;
  isDraftStatusLoading: boolean;
}): boolean {
  return !isDraft && !isStreaming && !isDraftStatusLoading;
}

export function resolveLinkedPanePublishState({
  isDraft,
  isStreaming,
  linkedSessionIds,
  canvases,
  hasSessionSnapshot,
  sessionSnapshot,
}: {
  isDraft: boolean;
  isStreaming: boolean;
  linkedSessionIds: string[];
  canvases: SessionCanvas[] | undefined;
  hasSessionSnapshot: boolean;
  sessionSnapshot:
    | {
        linkedSessionIds?: string[];
        canvases?: SessionCanvas[];
      }
    | undefined;
}): LinkedPanePublishState {
  if (isDraft) {
    return { linkedSessionIds: [], canvases: [] };
  }

  if (isStreaming) {
    return { linkedSessionIds, canvases: canvases ?? [] };
  }

  if (!hasSessionSnapshot) {
    return undefined;
  }

  return {
    linkedSessionIds: sessionSnapshot?.linkedSessionIds ?? [],
    canvases: sessionSnapshot?.canvases ?? [],
  };
}
