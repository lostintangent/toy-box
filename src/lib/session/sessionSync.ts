export type SessionStateSyncAction = "initialize-draft" | "sync-snapshot" | "skip";

export function resolveSessionStateSyncAction({
  isDraft,
  hasSynced,
  isStreaming,
  hasSnapshot,
}: {
  isDraft: boolean;
  hasSynced: boolean;
  isStreaming: boolean;
  hasSnapshot: boolean;
}): SessionStateSyncAction {
  if (isDraft) {
    return hasSynced ? "skip" : "initialize-draft";
  }

  if (isStreaming) {
    return "skip";
  }

  return hasSnapshot ? "sync-snapshot" : "skip";
}
