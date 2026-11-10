import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Automation } from "@automations/model";
import { automationQueries } from "@automations/queries";
import { workspaceQueries } from "./queries";
import { applyWorkspaceEvent } from "./sync";
import { createEmptyWorkspaceState, type WorkspaceState } from "./model/state/reducer";
import { providerQueries } from "@providers/queries";
import { sessionQueries, createEmptySessionsState } from "@sessions/queries";
import { createInitialSessionState } from "@sessions/model/reducer";
import type { AppInstance } from "@apps/model";
import { appQueries } from "@apps/queries";

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
const draft = { text: "Unsaved draft", origin: "client-a", updatedAt: 1 };

describe("workspace query cache", () => {
  test("applies live events directly to the cached workspace", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(workspaceQueries.state.queryKey, createEmptyWorkspaceState());

    applyWorkspaceEvent(queryClient, { type: "draft.changed", key: "session:session-a", draft });

    expect(readWorkspaceState(queryClient).drafts).toEqual({ "session:session-a": draft });
  });

  test("applies a complete settings event without disturbing other workspace state", () => {
    const queryClient = createQueryClient();
    const initial = createEmptyWorkspaceState();
    queryClient.setQueryData(workspaceQueries.state.queryKey, initial);
    const settings = { ...initial.settings, accentColor: "#123abc" as const };

    applyWorkspaceEvent(queryClient, { type: "settings.changed", settings });

    const state = readWorkspaceState(queryClient);
    expect(state.settings).toEqual(settings);
    expect(state.drafts).toBe(initial.drafts);
  });

  test("isolates live projections between QueryClient instances", () => {
    const firstQueryClient = createQueryClient();
    const secondQueryClient = createQueryClient();
    firstQueryClient.setQueryData(workspaceQueries.state.queryKey, createEmptyWorkspaceState());
    secondQueryClient.setQueryData(workspaceQueries.state.queryKey, createEmptyWorkspaceState());

    applyWorkspaceEvent(firstQueryClient, {
      type: "draft.changed",
      key: "session:session-a",
      draft,
    });

    expect(readWorkspaceState(firstQueryClient).drafts["session:session-a"]).toEqual(draft);
    expect(readWorkspaceState(secondQueryClient).drafts["session:session-a"]).toBeUndefined();
  });

  test("provider settings refresh catalogs on every client without invalidating histories", async () => {
    const clients = [createQueryClient(), createQueryClient()];
    const initial = createEmptyWorkspaceState();
    const modelKey = providerQueries.catalog().queryKey;
    const sessionKey = sessionQueries.state.queryKey;
    const historyKey = sessionQueries.detail("open-session").queryKey;
    for (const client of clients) {
      client.setQueryData(workspaceQueries.state.queryKey, initial);
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
      await Bun.sleep(0);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false);
    }
  });

  test("provider updates refresh models and versions on every client without touching sessions", async () => {
    const clients = [createQueryClient(), createQueryClient()];
    const initial = createEmptyWorkspaceState();
    const modelKey = providerQueries.catalog().queryKey;
    const versionKey = providerQueries.versions().queryKey;
    const sessionKey = sessionQueries.state.queryKey;
    const historyKey = sessionQueries.detail("open-session").queryKey;
    for (const client of clients) {
      client.setQueryData(workspaceQueries.state.queryKey, initial);
      client.setQueryData(modelKey, { providers: [], models: [] });
      client.setQueryData(versionKey, { claude: "1.0.0" });
      client.setQueryData(sessionKey, createEmptySessionsState());
      client.setQueryData(historyKey, createInitialSessionState());

      applyWorkspaceEvent(client, { type: "providers.changed" });
      await Bun.sleep(0);

      expect(client.getQueryState(modelKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(versionKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(false);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false);
      expect(readWorkspaceState(client)).toBe(initial);
    }
  });

  test("pin changes refresh session membership while identical echoes keep it fresh", async () => {
    const client = createQueryClient();
    const initial = createEmptyWorkspaceState();
    client.setQueryData(workspaceQueries.state.queryKey, initial);
    const sessionKey = sessionQueries.state.queryKey;
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
      await Bun.sleep(0);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(providerKey)?.isInvalidated).toBe(false);
      expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false);

      client.setQueryData(sessionKey, createEmptySessionsState());
      applyWorkspaceEvent(client, event);
      await Bun.sleep(0);
      expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(false);
    }
  });

  test("preserves cache identity for structurally equal entity echoes", () => {
    const queryClient = createQueryClient();
    const state = createEmptyWorkspaceState();
    queryClient.setQueryData(workspaceQueries.state.queryKey, state);

    const observer = new QueryObserver(queryClient, {
      ...workspaceQueries.state,
      enabled: false,
      notifyOnChangeProps: ["data"],
    });
    let updates = 0;
    const unsubscribe = observer.subscribe(() => updates++);
    onTestFinished(unsubscribe);

    applyWorkspaceEvent(queryClient, {
      type: "inbox.changed",
    });
    applyWorkspaceEvent(queryClient, {
      type: "settings.changed",
      settings: { ...state.settings, pinnedSessionIds: [...state.settings.pinnedSessionIds] },
    });
    expect(readWorkspaceState(queryClient)).toBe(state);
    expect(updates).toBe(0);
  });

  test("routes app events to the Apps cache without changing workspace state", () => {
    const client = createQueryClient();
    const workspace = createEmptyWorkspaceState();
    client.setQueryData(workspaceQueries.state.queryKey, workspace);
    client.setQueryData(appQueries.list.queryKey, { apps: [], definitions: [], shares: [] });
    const app: AppInstance = {
      id: "app-a",
      definitionId: "todo",
      title: "Todos",
      color: "#123abc",
      state: {},
      revision: 0,
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    };

    applyWorkspaceEvent(client, { type: "app.upserted", app });
    expect(client.getQueryData(appQueries.list.queryKey)?.apps).toEqual([app]);
    expect(readWorkspaceState(client)).toBe(workspace);

    applyWorkspaceEvent(client, { type: "app.deleted", appId: app.id });
    expect(client.getQueryData(appQueries.list.queryKey)?.apps).toEqual([]);
    expect(readWorkspaceState(client)).toBe(workspace);
  });

  test("routes automation events to the catalog and session ownership without changing workspace state", () => {
    const client = createQueryClient();
    const workspace = createEmptyWorkspaceState();
    client.setQueryData(workspaceQueries.state.queryKey, workspace);
    client.setQueryData(sessionQueries.state.queryKey, createEmptySessionsState());
    client.setQueryData(automationQueries.list.queryKey, []);
    applyWorkspaceEvent(client, { type: "automation.upserted", automation });
    expect(client.getQueryData(automationQueries.list.queryKey)).toEqual([automation]);
    expect(client.getQueryData(sessionQueries.state.queryKey)?.ownership).toEqual({
      [automation.id]: { type: "automation" },
    });
    expect(readWorkspaceState(client)).toBe(workspace);
    applyWorkspaceEvent(client, { type: "automation.deleted", automationId: automation.id });
    expect(client.getQueryData(automationQueries.list.queryKey)).toEqual([]);
    expect(client.getQueryData(sessionQueries.state.queryKey)?.ownership).toEqual({});
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

function readWorkspaceState(queryClient: QueryClient): WorkspaceState {
  const state = queryClient.getQueryData(workspaceQueries.state.queryKey);
  if (!state) throw new Error("Workspace state was not cached");
  return state;
}
