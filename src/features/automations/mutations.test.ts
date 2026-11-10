import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { SessionsState } from "@sessions/model";
import type { SessionActivity, SessionsActivity } from "@sessions/model/activity";
import { createEmptySessionsState, sessionQueries } from "@sessions/queries";
import type { Automation } from "./model";
import { automationMutations } from "./mutations";
import { automationQueries } from "./queries";

const automation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Daily summary",
  prompt: "Summarize the repository.",
  model: { provider: "copilot", name: "gpt-5" },
  cron: "0 9 * * *",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  nextRunAt: "2026-08-02T09:00:00.000Z",
} satisfies Automation;

describe("automation client behavior", () => {
  test("treats idempotent deletion as authoritative absence", async () => {
    const queryClient = createQueryClient(automation, { status: "running", since: 1 });
    await new MutationObserver(queryClient, {
      ...automationMutations.delete(automation.id),
      mutationFn: async () => false,
    }).mutate();

    expect(readActivity(queryClient)).toEqual({});
    expect(readSessions(queryClient).sessions).toEqual([]);
    expect(readSessions(queryClient).ownership).toEqual({});
    expect(queryClient.getQueryData(automationQueries.list.queryKey)).toEqual([]);
  });
});

function createQueryClient(seed?: Automation, activity?: SessionActivity): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    sessionQueries.activity.queryKey,
    seed && activity ? { [seed.id]: activity } : {},
  );
  queryClient.setQueryData(automationQueries.list.queryKey, seed ? [seed] : []);
  queryClient.setQueryData(sessionQueries.state.queryKey, {
    ...createEmptySessionsState(),
    ownership: seed ? { [seed.id]: { type: "automation" } } : {},
    sessions: seed
      ? [
          {
            id: seed.id,
            createdAt: new Date(seed.createdAt),
            updatedAt: new Date(seed.updatedAt),
            title: seed.title,
            provider: { id: seed.model.provider },
          },
        ]
      : [],
  });
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readActivity(queryClient: QueryClient): SessionsActivity {
  return queryClient.getQueryData(sessionQueries.activity.queryKey)!;
}

function readSessions(queryClient: QueryClient): SessionsState {
  return queryClient.getQueryData(sessionQueries.state.queryKey)!;
}
