import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import type { SessionsState, SessionState } from "@sessions/model";
import { createEmptySessionsState, sessionQueries } from "@sessions/queries";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import { createInitialSessionState } from "@sessions/model/reducer";
import type { Automation, AutomationOptions } from "./model";
import { automationMutations } from "./mutations";

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

const automationOptions = {
  title: automation.title,
  prompt: automation.prompt,
  model: automation.model,
  cron: automation.cron,
} satisfies AutomationOptions;

describe("automation client behavior", () => {
  test("projects created and updated definitions into workspace state", async () => {
    const queryClient = createQueryClient();

    await new MutationObserver(queryClient, {
      ...automationMutations.create(),
      mutationFn: async () => automation,
    }).mutate(automationOptions);
    expect(readWorkspace(queryClient).automations).toEqual([automation]);

    const updatedAutomation = {
      ...automation,
      title: "Morning summary",
      updatedAt: "2026-08-01T10:00:00.000Z",
    } satisfies Automation;
    await new MutationObserver(queryClient, {
      ...automationMutations.update(automation.id),
      mutationFn: async () => updatedAutomation,
    }).mutate(automationOptions);

    expect(readWorkspace(queryClient).automations).toEqual([updatedAutomation]);
  });

  test("treats idempotent deletion as authoritative absence", async () => {
    const queryClient = createQueryClient(automation, { status: "running" });
    await new MutationObserver(queryClient, {
      ...automationMutations.delete(automation.id),
      mutationFn: async () => false,
    }).mutate();

    expect(readWorkspace(queryClient)).toEqual(createEmptyWorkspaceState());
    expect(readSessions(queryClient).sessions).toEqual([]);
  });

  test("shows the prompt before dispatch and preserves streaming through request completion", async () => {
    const queryClient = createQueryClient(automation);
    const request = Promise.withResolvers<{ sessionId: string; started: boolean }>();
    const dispatched = Promise.withResolvers<void>();
    queryClient.setQueryData(sessionQueries.detail(automation.id).queryKey, {
      ...createInitialSessionState(),
      messages: [{ role: "assistant", content: "Previous run" }],
      lastSeenEventId: 100,
    });
    const runMutation = new MutationObserver(queryClient, {
      ...automationMutations.run(automation),
      mutationFn: () => {
        dispatched.resolve();
        return request.promise;
      },
    });

    const result = runMutation.mutate("requested-run");
    await dispatched.promise;
    expect(readWorkspace(queryClient).sessionStates).toEqual({});
    expect(readSessions(queryClient).sessions[0]?.provider).toBeUndefined();
    const optimistic = readSessionSnapshot(queryClient)!;
    expect(optimistic.model).toEqual(automation.model);
    expect(optimistic.status).toBe("thinking");
    expect(optimistic.messages).toEqual([
      expect.objectContaining({
        role: "user",
        clientId: "requested-run",
        content: automation.prompt,
      }),
    ]);

    const streamed: SessionState = {
      ...optimistic,
      messages: [...optimistic.messages, { role: "assistant", content: "Live response" }],
    };
    queryClient.setQueryData(sessionQueries.detail(automation.id).queryKey, streamed);
    request.resolve({ sessionId: automation.id, started: true });
    await result;
    expect(readSessionSnapshot(queryClient)).toEqual(streamed);
  });

  test.each(["started", "overlapped", "failed"])(
    "reconciles an optimistic run after it %s",
    async (outcome) => {
      const queryClient = createQueryClient(automation);
      queryClient.setQueryData(sessionQueries.detail(automation.id).queryKey, {
        ...createInitialSessionState(),
        messages: [{ role: "assistant", content: "Old transcript" }],
      });
      const sessions = {
        ...readSessions(queryClient),
        sessions: [
          {
            id: automation.id,
            title: automation.title,
            provider: { id: automation.model.provider },
            createdAt: new Date("2026-08-02T09:00:00Z"),
            updatedAt: new Date("2026-08-02T09:00:00Z"),
          },
        ],
      } satisfies SessionsState;
      const snapshot = {
        ...createInitialSessionState(),
        messages: [
          {
            role: "assistant",
            content: outcome === "failed" ? "Previous run" : "Latest server response",
          },
        ],
      } satisfies SessionState;
      const unsubscribeSessions = new QueryObserver(queryClient, {
        queryKey: sessionQueries.stateKey(),
        queryFn: async () => sessions,
        staleTime: Infinity,
      }).subscribe(() => {});
      const unsubscribeDetail = new QueryObserver(queryClient, {
        queryKey: sessionQueries.detail(automation.id).queryKey,
        queryFn: async () => snapshot,
        staleTime: Infinity,
      }).subscribe(() => {});
      onTestFinished(() => {
        unsubscribeSessions();
        unsubscribeDetail();
      });

      const result = new MutationObserver(queryClient, {
        ...automationMutations.run(automation),
        mutationFn: async () => {
          if (outcome === "failed") throw new Error("Could not start");
          return { sessionId: automation.id, started: outcome === "started" };
        },
      }).mutate("requested-run");
      if (outcome === "failed") await expect(result).rejects.toThrow("Could not start");
      else await result;

      expect(readSessionSnapshot(queryClient)).toEqual(snapshot);
      expect(readSessions(queryClient)).toEqual(sessions);
      expect(readWorkspace(queryClient).sessionStates).toEqual({});
    },
  );

  test.each(["running", "waiting"] as const)(
    "preserves the current conversation when Run is clicked while %s",
    async (status) => {
      const queryClient = createQueryClient(automation, { status });
      const sessions = readSessions(queryClient);
      const snapshot = {
        ...createInitialSessionState(),
        messages: [{ role: "assistant", content: "Current transcript" }],
        status: "thinking",
      } satisfies SessionState;
      queryClient.setQueryData(sessionQueries.detail(automation.id).queryKey, snapshot);
      await new MutationObserver(queryClient, {
        ...automationMutations.run(automation),
        mutationFn: async () => {
          expect(readSessionSnapshot(queryClient)).toEqual(snapshot);
          expect(readSessions(queryClient)).toEqual(sessions);
          return { sessionId: automation.id, started: false };
        },
      }).mutate("requested-run");

      expect(readSessionSnapshot(queryClient)).toEqual(snapshot);
    },
  );
});

function createQueryClient(
  seed?: Automation,
  sessionState?: WorkspaceState["sessionStates"][string],
): QueryClient {
  const queryClient = new QueryClient();
  const workspace: WorkspaceState = seed
    ? {
        ...createEmptyWorkspaceState(),
        automations: [seed],
        sessionStates: sessionState ? { [seed.id]: sessionState } : {},
      }
    : createEmptyWorkspaceState();
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), workspace);
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), {
    ...createEmptySessionsState(),
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

function readWorkspace(queryClient: QueryClient): WorkspaceState {
  return queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey())!;
}

function readSessions(queryClient: QueryClient): SessionsState {
  return queryClient.getQueryData<SessionsState>(sessionQueries.stateKey())!;
}

function readSessionSnapshot(queryClient: QueryClient): SessionState | undefined {
  return queryClient.getQueryData<SessionState>(sessionQueries.detail(automation.id).queryKey);
}
