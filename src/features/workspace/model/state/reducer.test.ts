import { describe, expect, test } from "bun:test";
import { createEmptyWorkspaceState, reduceWorkspaceState } from "./reducer";
import type { WorkspaceEvent } from "@workspace/model/events";

const sessionId = "session-a";
const draft = { text: "hello", origin: "client-a", updatedAt: 3 };

describe("saved drafts", () => {
  test("a draft change replaces that composer's draft and ignores an equal echo", () => {
    const initial = createEmptyWorkspaceState();
    const drafted = reduceWorkspaceState(initial, {
      type: "draft.changed",
      key: "channel:c1",
      draft,
    });
    expect(drafted.drafts).toEqual({ "channel:c1": draft });
    expect(
      reduceWorkspaceState(drafted, {
        type: "draft.changed",
        key: "channel:c1",
        draft: { ...draft },
      }),
    ).toBe(drafted);
    const edited = { ...draft, text: "hello again", updatedAt: 4 };
    expect(
      reduceWorkspaceState(drafted, { type: "draft.changed", key: "channel:c1", draft: edited })
        .drafts,
    ).toEqual({ "channel:c1": edited });
  });

  test("deleting a session or channel drops only its own draft", () => {
    const state = {
      ...createEmptyWorkspaceState(),
      drafts: { [`session:${sessionId}`]: draft, "channel:c1": draft, inbox: draft },
    };
    const withoutSession = reduceWorkspaceState(state, { type: "session.deleted", sessionId });
    expect(withoutSession.drafts).toEqual({ "channel:c1": draft, inbox: draft });
    expect(
      reduceWorkspaceState(withoutSession, { type: "channel.deleted", channelId: "c1" }).drafts,
    ).toEqual({ inbox: draft });
  });
});

describe("workspace state reducer", () => {
  test("replaces settings atomically and ignores an equal echo", () => {
    const initial = createEmptyWorkspaceState();
    const settings = {
      ...initial.settings,
      accentColor: "#123abc" as const,
      defaultModel: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
      pinnedSessionIds: ["session-a"],
    };
    const state = reduceWorkspaceState(initial, { type: "settings.changed", settings });

    expect(state.settings).toBe(settings);
    expect(
      reduceWorkspaceState(state, {
        type: "settings.changed",
        settings: {
          ...settings,
          defaultModel: { ...settings.defaultModel },
          pinnedSessionIds: [...settings.pinnedSessionIds],
        },
      }),
    ).toBe(state);
  });

  test("projects Hyper membership from catalog creation idempotently", () => {
    let state = createEmptyWorkspaceState();
    const event: WorkspaceEvent = {
      type: "session.upserted",
      session: { id: sessionId, sessionType: "hyper" },
    };

    state = reduceWorkspaceState(state, event);
    const duplicate = reduceWorkspaceState(state, event);

    expect(duplicate).toBe(state);
    expect(state.hyperSessionIds).toEqual([sessionId]);
  });

  test("delete clears every workspace fact for a session", () => {
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "session.upserted",
      session: { id: sessionId, sessionType: "hyper" },
    });
    state = reduceWorkspaceState(state, {
      type: "draft.changed",
      key: `session:${sessionId}`,
      draft,
    });
    state = reduceWorkspaceState(state, { type: "session.deleted", sessionId });
    expect(state).toEqual(createEmptyWorkspaceState());
  });

  test("Inbox events leave shared workspace facts unchanged", () => {
    const entry = { id: "entry-a", createdAt: "2026-01-01T00:00:00.000Z", message: "Ready" };
    const state = createEmptyWorkspaceState();
    expect(reduceWorkspaceState(state, { type: "inbox.changed" })).toBe(state);
    expect(reduceWorkspaceState(state, { type: "inbox.entry.deleted", entryId: entry.id })).toBe(
      state,
    );
    expect(reduceWorkspaceState(state, { type: "inbox.changed" })).toBe(state);
  });
});
