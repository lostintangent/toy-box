import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCache } from "@workspace/sync";
import { replaceOverlappingRead } from "@/shared/query";
import { workspaceFileId, type CustomEditorKind, type FileChange } from "./model";
import { fileQueries } from "./queries";

export default {
  applyEvent(queryClient, event) {
    if (event.type === "file.changed" || event.type === "file.deleted") {
      applyFileChange(queryClient, event);
      return;
    }
    if (event.type !== "editor.registered") return;
    queryClient.setQueryData<CustomEditorKind[]>(fileQueries.editorsKey(), (kinds) => {
      if (!kinds) return kinds;
      const index = kinds.findIndex(({ name }) => name === event.kind.name);
      if (kinds[index] === event.kind) return kinds;
      return index === -1
        ? [...kinds, event.kind]
        : kinds.map((kind, current) => (current === index ? event.kind : kind));
    });
    replaceOverlappingRead(queryClient, fileQueries.editorsKey());
  },
  refresh: (queryClient) =>
    queryClient.invalidateQueries({ queryKey: fileQueries.editorsKey(), exact: true }),
} satisfies WorkspaceCache;

// Only a file this tab has read is affected, and only when the change is news to it.
function applyFileChange(queryClient: QueryClient, change: FileChange): void {
  const queryKey = fileQueries.detailKey(workspaceFileId(change.file));
  const snapshot = queryClient.getQueryData<{ timestamp: number } | null>(queryKey);
  if (snapshot === undefined) return;
  if (change.type === "file.deleted") {
    queryClient.setQueryData(queryKey, null);
  } else if (snapshot?.timestamp !== change.timestamp) {
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }
}
