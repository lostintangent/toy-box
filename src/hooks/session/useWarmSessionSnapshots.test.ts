import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { warmSessionSnapshotQuery } from "@/hooks/session/useWarmSessionSnapshots";
import { sessionQueries } from "@/lib/queries";
import type { SessionSnapshot } from "@/types";

describe("warm session snapshot retention", () => {
  test("holds a snapshot once its pane closes, and releases it when no longer warm", async () => {
    // Collection is immediate here so retention is observable without timers.
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    onTestFinished(() => queryClient.clear());

    const { queryKey } = warmSessionSnapshotQuery("warm-session");
    queryClient.setQueryData<SessionSnapshot>(queryKey, {
      id: "warm-session",
      messages: [],
      queuedMessages: [],
      status: "idle",
      reasoningContent: "",
    });

    const stopWarming = observe(queryClient, warmSessionSnapshotQuery("warm-session"));
    const closePane = observe(queryClient, sessionQueries.detail("warm-session"));

    closePane();
    await collectGarbage();
    expect(queryClient.getQueryData(queryKey)).toBeDefined();

    stopWarming();
    await collectGarbage();
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });
});

/** Subscribes without fetching, so retention is what the test observes. */
function observe(queryClient: QueryClient, options: { queryKey: readonly unknown[] }): () => void {
  return new QueryObserver(queryClient, { ...options, enabled: false }).subscribe(() => {});
}

function collectGarbage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
