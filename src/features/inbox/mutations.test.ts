import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import type { InboxEntry } from "./model";
import { inboxMutations } from "./mutations";

const entry = {
  id: "inbox-a",
  createdAt: "2026-08-01T12:00:00.000Z",
  message: "Finished task",
} satisfies InboxEntry;

describe("inbox mutation options", () => {
  test("removes successfully deleted and already-absent entries", async () => {
    for (const result of [true, false]) {
      const queryClient = createQueryClient();
      await new MutationObserver(queryClient, {
        ...inboxMutations.deleteEntry(entry.id),
        mutationFn: async () => result,
      }).mutate();

      expect(readEntries(queryClient)).toEqual([]);
    }
  });

  test("leaves the cache alone when deletion fails", async () => {
    const queryClient = createQueryClient();
    const deleteMutation = new MutationObserver(queryClient, {
      ...inboxMutations.deleteEntry(entry.id),
      mutationFn: async () => {
        throw new Error("delete failed");
      },
    });

    await expect(deleteMutation.mutate()).rejects.toThrow("delete failed");

    expect(readEntries(queryClient)).toEqual([entry]);
    expect(queryClient.getQueryState(workspaceQueries.stateKey())?.isInvalidated).toBe(false);
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), {
    ...createEmptyWorkspaceState(),
    inboxEntries: [entry],
  });
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readEntries(queryClient: QueryClient): InboxEntry[] {
  return queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey())?.inboxEntries ?? [];
}
