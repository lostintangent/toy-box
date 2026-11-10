import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  selectAutomationSessionIds,
  selectNonWorkerSessions,
  selectTopLevelSessions,
  selectSessionChildren,
  sessionQueries,
} from "./queries";
import type { Message, SessionsState } from "./model";
import { createInitialSessionState } from "./model/reducer";

describe("session detail", () => {
  test("a fresh latest page keeps the previous pages and rows already loaded", async () => {
    const queryClient = new QueryClient();
    const query = sessionQueries.detail("session-a");
    const state = (messageOffset: number, ...contents: string[]) =>
      createInitialSessionState({
        messages: contents.map((content): Message => ({ role: "user", content })),
        messageOffset,
      });
    const loaded = state(1, "1", "2", "3");
    await queryClient.query({ ...query, queryFn: async () => loaded });

    queryClient.setQueryData(query.queryKey, state(2, "2", "3", "4"));

    const data = queryClient.getQueryData(query.queryKey);
    expect(data).toEqual(state(1, "1", "2", "3", "4"));
    expect(data?.messages[1]).toBe(loaded.messages[1]);
  });
});

describe("session list projection", () => {
  test("sidebar roots and composer references exclude every managed surface", () => {
    const sessions = [
      "standard",
      "external",
      "child",
      "inbox",
      "channel",
      "automation",
      "hyper",
    ].map((id) => ({ id, createdAt: new Date(0), updatedAt: new Date(0) }));
    const state: SessionsState = {
      sessions,
      worktrees: {},
      ownership: {
        child: { type: "worker", parentSessionId: "standard" },
        inbox: { type: "worker", parentSessionId: null },
        channel: { type: "worker", parentSessionId: null },
        automation: { type: "automation" },
      },
    };
    expect(selectTopLevelSessions(state, "hyper")).toEqual(sessions.slice(0, 2));
  });

  test("excludes managed worker sessions while preserving canonical metadata", () => {
    const standard = {
      id: "standard",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      title: "Standard",
    };
    const workers = ["session-worker", "file-worker", "app-worker"].map((id) => ({
      ...standard,
      id,
      title: "Implementation detail",
    }));
    const state: SessionsState = {
      sessions: [...workers, standard],
      worktrees: {},
      ownership: Object.fromEntries(
        workers.map(({ id }) => [id, { type: "worker", parentSessionId: null }]),
      ),
    };

    expect(selectNonWorkerSessions(state)).toEqual([standard]);
    expect(state.sessions).toEqual([...workers, standard]);
  });

  test("automation membership does not require a backing session", () => {
    const state: SessionsState = {
      sessions: [],
      worktrees: {},
      ownership: {
        scheduled: { type: "automation" },
        inbox: { type: "worker", parentSessionId: null },
      },
    };
    expect(selectAutomationSessionIds(state)).toEqual(["scheduled"]);
  });

  test("indexes retained children by their immediate parent without exposing unrelated workers", () => {
    const sessions = [
      "parent",
      "child",
      "file-worker",
      "grandchild",
      "app-worker",
      "channel-worker",
      "inbox-worker",
      "automation",
    ].map((id) => ({ id, createdAt: new Date(0), updatedAt: new Date(0) }));
    const state: SessionsState = {
      sessions,
      worktrees: {},
      ownership: {
        child: { type: "worker", parentSessionId: "parent" },
        "file-worker": { type: "worker", parentSessionId: "parent" },
        grandchild: { type: "worker", parentSessionId: "child" },
        "app-worker": { type: "worker", parentSessionId: null },
        "channel-worker": { type: "worker", parentSessionId: null },
        "inbox-worker": { type: "worker", parentSessionId: null },
        automation: { type: "automation" },
        reserved: { type: "worker", parentSessionId: "parent" },
      },
    };

    expect(selectSessionChildren(state)).toEqual({
      parent: [sessions[1], sessions[2]],
      child: [sessions[3]],
    });
    expect(selectSessionChildren(state).parent?.[0]).toBe(sessions[1]);
  });
});
