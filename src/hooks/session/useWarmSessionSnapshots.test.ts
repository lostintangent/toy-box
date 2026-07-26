import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  selectWarmSessionIds,
  warmSessionSnapshotQuery,
} from "@/hooks/session/useWarmSessionSnapshots";
import { sessionQueries } from "@/lib/queries";
import type { SessionMetadata, SessionSnapshot } from "@/types";

function session(sessionId: string): SessionMetadata {
  return {
    sessionId,
    startTime: new Date(0),
    modifiedTime: new Date(0),
    summary: sessionId,
    isRemote: false,
  };
}

describe("warm session selection", () => {
  const cases: Array<{
    name: string;
    pinnedSessionIds: string[];
    recentSessions: SessionMetadata[];
    warmSessionIds: string[];
  }> = [
    {
      name: "warms pinned sessions ahead of recent ones",
      pinnedSessionIds: ["pinned"],
      recentSessions: [session("newest"), session("next")],
      warmSessionIds: ["pinned", "newest", "next"],
    },
    {
      name: "takes only the leading recent sessions",
      pinnedSessionIds: [],
      recentSessions: [session("newest"), session("next"), session("older")],
      warmSessionIds: ["newest", "next"],
    },
    {
      name: "counts a pinned session that is also recent once",
      pinnedSessionIds: ["newest"],
      recentSessions: [session("newest"), session("next")],
      warmSessionIds: ["newest", "next"],
    },
    {
      name: "warms pinned sessions when none are listed",
      pinnedSessionIds: ["pinned"],
      recentSessions: [],
      warmSessionIds: ["pinned"],
    },
    {
      name: "warms nothing without pinned or recent sessions",
      pinnedSessionIds: [],
      recentSessions: [],
      warmSessionIds: [],
    },
  ];

  test.each(cases)("$name", (testCase) => {
    expect(selectWarmSessionIds(testCase.pinnedSessionIds, testCase.recentSessions)).toEqual(
      testCase.warmSessionIds,
    );
  });
});

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
