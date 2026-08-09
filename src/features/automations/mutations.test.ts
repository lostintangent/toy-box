import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { SessionsState } from "@sessions/model";
import { createEmptySessionsState, sessionQueries } from "@sessions/queries";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import type { SessionSnapshot } from "@sessions/model";
import type { Automation, AutomationOptions } from "./model";
import { automationMutations } from "./mutations";

const automation = {
  id: "toy-box-auto-11111111-1111-4111-8111-111111111111",
  title: "Daily summary",
  prompt: "Summarize the repository.",
  model: { name: "gpt-5" },
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

describe("automation mutation options", () => {
  test("projects created and updated definitions into workspace state", async () => {
    const queryClient = createQueryClient();

    await new MutationObserver(queryClient, {
      ...automationMutations.create(),
      mutationFn: async () => automation,
    }).mutate(automationOptions);
    expect(readAutomations(queryClient)).toEqual([automation]);

    const updatedAutomation = {
      ...automation,
      title: "Morning summary",
      updatedAt: "2026-08-01T10:00:00.000Z",
    } satisfies Automation;
    await new MutationObserver(queryClient, {
      ...automationMutations.update(automation.id),
      mutationFn: async () => updatedAutomation,
    }).mutate(automationOptions);

    expect(readAutomations(queryClient)).toEqual([updatedAutomation]);
  });

  test("treats idempotent deletion as authoritative absence", async () => {
    const queryClient = createQueryClient(automation);
    await new MutationObserver(queryClient, {
      ...automationMutations.delete(automation.id),
      mutationFn: async () => false,
    }).mutate();

    expect(readWorkspace(queryClient)).toEqual(createEmptyWorkspaceState());
    expect(readSessions(queryClient).sessions).toEqual([]);
  });

  test("leaves cached state unchanged when a request fails", async () => {
    const queryClient = createQueryClient(automation);
    const updateMutation = new MutationObserver(queryClient, {
      ...automationMutations.update(automation.id),
      mutationFn: async () => {
        throw new Error("network unavailable");
      },
    });

    await expect(updateMutation.mutate(automationOptions)).rejects.toThrow("network unavailable");
    expect(readAutomations(queryClient)).toEqual([automation]);
    expect(readSessions(queryClient).sessions).toHaveLength(1);
  });

  test("primes a genuinely started run without replacing an overlapping run", async () => {
    const startedClient = createQueryClient(automation);
    startedClient.setQueryData<SessionSnapshot>(sessionQueries.detail(automation.id).queryKey, {
      id: automation.id,
      messages: [{ role: "assistant", content: "Old transcript" }],
      queuedMessages: [],
      status: "idle",
      reasoningContent: "",
    });

    await new MutationObserver(startedClient, {
      ...automationMutations.run(automation.id),
      mutationFn: async () => ({ sessionId: automation.id, started: true }),
    }).mutate();

    const startedSnapshot = {
      id: automation.id,
      messages: [],
      queuedMessages: [],
      model: automation.model,
      status: "thinking",
      reasoningContent: "",
    } satisfies SessionSnapshot;
    expect(readSessionSnapshot(startedClient)).toEqual(startedSnapshot);
    expect(readSessions(startedClient).sessions).toEqual([
      {
        sessionId: automation.id,
        startTime: expect.any(Date),
        modifiedTime: expect.any(Date),
        summary: automation.title,
        isRemote: false,
      },
    ]);

    const overlappingClient = createQueryClient(automation);
    const previousSnapshot = {
      id: automation.id,
      messages: [{ role: "assistant", content: "Current transcript" }],
      queuedMessages: [],
      status: "thinking",
      reasoningContent: "",
    } satisfies SessionSnapshot;
    overlappingClient.setQueryData(sessionQueries.detail(automation.id).queryKey, previousSnapshot);
    await new MutationObserver(overlappingClient, {
      ...automationMutations.run(automation.id),
      mutationFn: async () => ({ sessionId: automation.id, started: false }),
    }).mutate();

    expect(readSessionSnapshot(overlappingClient)).toBe(previousSnapshot);
  });
});

function createQueryClient(seed?: Automation): QueryClient {
  const queryClient = new QueryClient();
  const workspace: WorkspaceState = seed
    ? {
        ...createEmptyWorkspaceState(),
        automations: [seed],
        sessionStates: { [seed.id]: { status: "running" } },
      }
    : createEmptyWorkspaceState();
  queryClient.setQueryData<WorkspaceState>(workspaceQueries.stateKey(), workspace);
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), {
    ...createEmptySessionsState(),
    sessions: seed
      ? [
          {
            sessionId: seed.id,
            startTime: new Date(seed.createdAt),
            modifiedTime: new Date(seed.updatedAt),
            summary: seed.title,
            isRemote: false,
          },
        ]
      : [],
  });
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readAutomations(queryClient: QueryClient): Automation[] {
  return readWorkspace(queryClient).automations;
}

function readWorkspace(queryClient: QueryClient): WorkspaceState {
  const workspace = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey());
  if (!workspace) throw new Error("Workspace state was not cached");
  return workspace;
}

function readSessions(queryClient: QueryClient): SessionsState {
  const sessions = queryClient.getQueryData<SessionsState>(sessionQueries.stateKey());
  if (!sessions) throw new Error("Sessions state was not cached");
  return sessions;
}

function readSessionSnapshot(queryClient: QueryClient): SessionSnapshot | undefined {
  return queryClient.getQueryData<SessionSnapshot>(["sessions", "detail", automation.id]);
}
