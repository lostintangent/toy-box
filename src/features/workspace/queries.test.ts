import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Automation } from "@automations/model";
import { applyWorkspaceEvent, createWorkspaceQuerySource, workspaceQueries } from "./queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "./model/state/reducer";
import { providerQueries } from "@providers/queries";
import { sessionQueries, createEmptySessionsState } from "@sessions/queries";
import { createInitialSessionState } from "@sessions/model/reducer";

const automation = {
  id: "automation-a",
  title: "Daily summary",
  prompt: "Summarize repo status.",
  model: { provider: "copilot", name: "gpt-5" },
  cron: "0 9 * * *",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nextRunAt: "2026-01-02T09:00:00.000Z",
} satisfies Automation;

describe("workspace query cache", () => {
  test("applies live events directly to the cached workspace", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());

    applyWorkspaceEvent(queryClient, { type: "session.running", sessionId: "session-a" });

    expect(readWorkspaceState(queryClient).sessionStates["session-a"]).toEqual({
      status: "running",
    });
  });

  test("applies a complete settings event without disturbing other workspace state", () => {
    const queryClient = createQueryClient();
    const initial = createEmptyWorkspaceState();
    queryClient.setQueryData(workspaceQueries.stateKey(), initial);
    const settings = { ...initial.settings, accentColor: "#123abc" as const };

    applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });

    const state = readWorkspaceState(queryClient);
    expect(state.settings).toEqual(settings);
    expect(state.sessionStates).toBe(initial.sessionStates);
  });

  test("isolates live projections between QueryClient instances", () => {
    const firstQueryClient = createQueryClient();
    const secondQueryClient = createQueryClient();
    firstQueryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());
    secondQueryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());

    applyWorkspaceEvent(firstQueryClient, {
      type: "session.running",
      sessionId: "session-a",
    });

    expect(readWorkspaceState(firstQueryClient).sessionStates["session-a"]?.status).toBe("running");
    expect(readWorkspaceState(secondQueryClient).sessionStates["session-a"]).toBeUndefined();
  });

  test("provider settings refresh catalogs on every client without invalidating histories", () => {
    const clients = [createQueryClient(), createQueryClient()];
    const initial = createEmptyWorkspaceState();
    const modelKey = providerQueries.catalog().queryKey;
    const sessionKey = sessionQueries.stateKey();
    const historyKey = sessionQueries.detail("open-session").queryKey;
    for (const client of clients) {
      client.setQueryData(workspaceQueries.stateKey(), initial);
      client.setQueryData(modelKey, { providers: [], models: [] });
      client.setQueryData(sessionKey, createEmptySessionsState());
      client.setQueryData(historyKey, createInitialSessionState());
      applyWorkspaceEvent(client, {
        type: "settings.changed",
        settings: { ...initial.settings, accentColor: "#123abc" },
      });
      expect(client.getQueryState(modelKey)?.isInvalidated).toBe(false);
      applyWorkspaceEvent(client, {
        type: "settings.changed",
        settings: { ...initial.settings, disabledProviders: ["claude", "copilot"] },
      });
      expect(client.getQueryState(modelKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false);
    }
  });

  test("provider updates refresh models and versions on every client without touching sessions", () => {
    const clients = [createQueryClient(), createQueryClient()];
    const initial = createEmptyWorkspaceState();
    const modelKey = providerQueries.catalog().queryKey;
    const versionKey = providerQueries.versions().queryKey;
    const sessionKey = sessionQueries.stateKey();
    const historyKey = sessionQueries.detail("open-session").queryKey;
    for (const client of clients) {
      client.setQueryData(workspaceQueries.stateKey(), initial);
      client.setQueryData(modelKey, { providers: [], models: [] });
      client.setQueryData(versionKey, { claude: "1.0.0" });
      client.setQueryData(sessionKey, createEmptySessionsState());
      client.setQueryData(historyKey, createInitialSessionState());

      applyWorkspaceEvent(client, { type: "providers.changed" });

      expect(client.getQueryState(modelKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(versionKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(false);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false);
      expect(readWorkspaceState(client)).toBe(initial);
    }
  });

  test("pin changes refresh session membership while identical echoes keep it fresh", () => {
    const client = createQueryClient();
    const initial = createEmptyWorkspaceState();
    client.setQueryData(workspaceQueries.stateKey(), initial);
    const sessionKey = sessionQueries.stateKey();
    const providerKey = providerQueries.catalog().queryKey;
    const historyKey = sessionQueries.detail("old-pin").queryKey;
    client.setQueryData(providerKey, { providers: [], models: [] });
    client.setQueryData(historyKey, createInitialSessionState());

    for (const pinnedSessionIds of [["old-pin"], []]) {
      client.setQueryData(sessionKey, createEmptySessionsState());
      const event = {
        type: "settings.changed" as const,
        settings: { ...initial.settings, pinnedSessionIds },
      };
      applyWorkspaceEvent(client, event);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(providerKey)?.isInvalidated).toBe(false);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false);

      client.setQueryData(sessionKey, createEmptySessionsState());
      applyWorkspaceEvent(client, event);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(false);
    }
  });

  test("preserves cache identity for structurally equal entity echoes", () => {
    const queryClient = createQueryClient();
    const entry = { id: "entry-a", createdAt: "2026-01-01T00:00:00.000Z" };
    const kind = {
      name: "json-tree",
      extensions: ["json"],
      icon: "json",
      editable: false,
      html: "<html></html>",
    };
    const state = {
      ...createEmptyWorkspaceState(),
      automations: [automation],
      inboxEntries: [entry],
      customEditors: [kind],
    };
    queryClient.setQueryData(workspaceQueries.stateKey(), state);

    const observer = new QueryObserver(queryClient, {
      ...workspaceQueries.state(),
      enabled: false,
      notifyOnChangeProps: ["data"],
    });
    let updates = 0;
    const unsubscribe = observer.subscribe(() => updates++);
    onTestFinished(unsubscribe);

    applyWorkspaceEvent(queryClient, {
      type: "automation.upserted",
      automation: { ...automation, model: { ...automation.model } },
    });
    applyWorkspaceEvent(queryClient, {
      type: "inbox.entry.upserted",
      entry: { ...entry },
    });
    applyWorkspaceEvent(queryClient, {
      type: "editor.registered",
      kind: { ...kind, extensions: [...kind.extensions] },
    });

    expect(readWorkspaceState(queryClient)).toBe(state);
    expect(updates).toBe(0);
  });

  test("returns snapshots reconciled with all events received during the read", async () => {
    const snapshot = deferred<WorkspaceState>();
    const source = createWorkspaceQuerySource();

    const read = source.readSnapshot(() => snapshot.promise);
    source.recordEvent({ type: "session.running", sessionId: "session-a" });
    source.recordEvent({ type: "automation.upserted", automation });
    snapshot.resolve(createEmptyWorkspaceState());

    const state = await read;
    expect(state.sessionStates["session-a"]).toEqual({ status: "running" });
    expect(state.automations).toEqual([automation]);
  });

  test("lets Query populate an empty cache with a reconciled snapshot", async () => {
    const queryClient = createQueryClient();
    const snapshot = deferred<WorkspaceState>();
    const source = createWorkspaceQuerySource();

    const fetch = queryClient.fetchQuery({
      queryKey: workspaceQueries.stateKey(),
      queryFn: () => source.readSnapshot(() => snapshot.promise),
      retry: false,
    });
    source.recordEvent({ type: "session.running", sessionId: "session-a" });
    expect(queryClient.getQueryData(workspaceQueries.stateKey())).toBeUndefined();

    snapshot.resolve(createEmptyWorkspaceState());
    await fetch;
    expect(readWorkspaceState(queryClient).sessionStates["session-a"]).toEqual({
      status: "running",
    });
  });

  test("carries buffered events into a replacement Query fetch", async () => {
    const queryClient = createQueryClient();
    const first = deferred<WorkspaceState>();
    const second = deferred<WorkspaceState>();
    const snapshots = [first.promise, second.promise];
    const source = createWorkspaceQuerySource();
    queryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());
    const query = {
      queryKey: workspaceQueries.stateKey(),
      queryFn: () => source.readSnapshot(() => snapshots.shift()!),
      retry: false,
      staleTime: 0,
    };

    const firstFetch = queryClient.fetchQuery(query);
    const event = { type: "session.running", sessionId: "session-a" } as const;
    source.recordEvent(event);
    applyWorkspaceEvent(queryClient, event);
    const replacementFetch = queryClient.refetchQueries(
      { queryKey: workspaceQueries.stateKey(), exact: true },
      { throwOnError: true },
    );

    first.resolve({
      ...createEmptyWorkspaceState(),
      sessionStates: { "stale-session": { status: "running" } },
    });
    await Promise.resolve();
    expect(readWorkspaceState(queryClient).sessionStates["stale-session"]).toBeUndefined();

    second.resolve(createEmptyWorkspaceState());
    await Promise.all([firstFetch, replacementFetch]);
    expect(readWorkspaceState(queryClient).sessionStates).toEqual({
      "session-a": { status: "running" },
    });
  });

  test("keeps live cache data when a snapshot fetch fails", async () => {
    const queryClient = createQueryClient();
    const snapshot = deferred<WorkspaceState>();
    const source = createWorkspaceQuerySource();
    queryClient.setQueryData(workspaceQueries.stateKey(), createEmptyWorkspaceState());

    const fetch = queryClient.fetchQuery({
      queryKey: workspaceQueries.stateKey(),
      queryFn: () => source.readSnapshot(() => snapshot.promise),
      retry: false,
      staleTime: 0,
    });
    const event = { type: "session.running", sessionId: "session-a" } as const;
    source.recordEvent(event);
    applyWorkspaceEvent(queryClient, event);
    snapshot.reject(new Error("snapshot failed"));

    await expect(fetch).rejects.toThrow("snapshot failed");
    expect(readWorkspaceState(queryClient).sessionStates["session-a"]).toEqual({
      status: "running",
    });
  });

  test("can discard a rejected transition before the replacement snapshot", async () => {
    const first = deferred<WorkspaceState>();
    const second = deferred<WorkspaceState>();
    const snapshots = [first.promise, second.promise];
    const source = createWorkspaceQuerySource();

    const firstRead = source.readSnapshot(() => snapshots.shift()!);
    source.recordEvent({
      type: "session.prompt.drafted",
      sessionId: "session-a",
      prompt: { text: "Unsaved prompt", origin: "client-a", updatedAt: 1 },
    });
    source.discardBufferedEvents();
    const replacementRead = source.readSnapshot(() => snapshots.shift()!);

    second.resolve(createEmptyWorkspaceState());
    expect((await replacementRead).sessionStates["session-a"]).toBeUndefined();

    first.resolve(createEmptyWorkspaceState());
    await firstRead;
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readWorkspaceState(queryClient: QueryClient): WorkspaceState {
  const state = queryClient.getQueryData<WorkspaceState>(workspaceQueries.stateKey());
  if (!state) throw new Error("Workspace state was not cached");
  return state;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
