import { describe, expect, test } from "bun:test";
import {
  createEmptyWorkspaceState,
  reduceWorkspaceSessionState,
  reduceWorkspaceState,
  type WorkspaceSessionEvent,
  type WorkspaceSessionState,
} from "./state";
import type { WorkspaceEvent } from "@/types";

const sessionId = "session-a";
const prompt = { text: "hello", origin: "client-a", updatedAt: 3 };

describe("workspace session state", () => {
  test("models the complete draft promotion lifecycle", () => {
    let state: WorkspaceSessionState | undefined;

    state = transition(state, {
      type: "session.draft.created",
      sessionId,
      createdAt: 1,
    });
    expect(state).toEqual({ status: "draft", createdAt: 1 });

    state = transition(state, { type: "session.prompt.drafted", sessionId, prompt });
    expect(state).toEqual({ status: "draft", createdAt: 1, prompt });

    state = transition(state, { type: "session.creating", sessionId });
    expect(state).toEqual({ status: "creating", createdAt: 1, prompt });

    state = transition(state, {
      type: "session.upserted",
      session: { sessionId },
    });
    expect(state).toEqual({ status: "running", prompt });
  });

  test("restores a draft when creation fails", () => {
    const creating: WorkspaceSessionState = { status: "creating", createdAt: 1, prompt };
    expect(transition(creating, { type: "session.idle", sessionId })).toEqual({
      status: "draft",
      createdAt: 1,
      prompt,
    });
  });

  test("makes running, unread, and idle mutually exclusive", () => {
    let state = transition(undefined, { type: "session.running", sessionId });
    expect(state).toEqual({ status: "running" });

    state = transition(state, { type: "session.unread", sessionId });
    expect(state).toEqual({ status: "unread" });

    state = transition(state, { type: "session.read", sessionId });
    expect(state).toBeUndefined();
  });

  test("keeps a composed prompt through runtime transitions", () => {
    let state = transition(undefined, { type: "session.prompt.drafted", sessionId, prompt });
    expect(state).toEqual({ status: "idle", prompt });

    state = transition(state, { type: "session.running", sessionId });
    expect(state).toEqual({ status: "running", prompt });

    state = transition(state, { type: "session.unread", sessionId });
    expect(state).toEqual({ status: "unread", prompt });

    state = transition(state, { type: "session.read", sessionId });
    expect(state).toEqual({ status: "idle", prompt });
  });

  test("canonicalizes idle sessions without prompts as missing", () => {
    expect(transition(undefined, { type: "session.idle", sessionId })).toBeUndefined();
    expect(transition({ status: "running" }, { type: "session.idle", sessionId })).toBeUndefined();
  });

  test("ignores stale draft lifecycle events after promotion", () => {
    const running: WorkspaceSessionState = { status: "running" };
    expect(
      transition(running, {
        type: "session.draft.created",
        sessionId,
        createdAt: 1,
      }),
    ).toBe(running);
    expect(transition(running, { type: "session.draft.discarded", sessionId })).toBe(running);
    expect(transition(running, { type: "session.creating", sessionId })).toBe(running);

    const creating: WorkspaceSessionState = { status: "creating", createdAt: 1 };
    expect(
      transition(creating, {
        type: "session.draft.created",
        sessionId,
        createdAt: 2,
      }),
    ).toBe(creating);
  });
});

describe("workspace state reducer", () => {
  test("updates session and hyper state atomically and idempotently", () => {
    let state = createEmptyWorkspaceState();
    const event: WorkspaceEvent = {
      type: "session.draft.created",
      sessionId,
      createdAt: 1,
      hyper: true,
    };

    state = reduceWorkspaceState(state, event);
    const duplicate = reduceWorkspaceState(state, event);

    expect(duplicate).toBe(state);
    expect(state.sessionStates[sessionId]).toEqual({ status: "draft", createdAt: 1 });
    expect(state.hyperSessionIds).toEqual([sessionId]);
  });

  test("delete clears every workspace fact for a session", () => {
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "session.draft.created",
      sessionId,
      createdAt: 1,
      hyper: true,
    });
    state = reduceWorkspaceState(state, {
      type: "artifact.comment_session.linked",
      commentSession: {
        sessionId: "comment-session-a",
        sourceSessionId: sessionId,
        path: "plan.md",
        threadId: "thread-a",
      },
    });
    state = reduceWorkspaceState(state, { type: "session.deleted", sessionId });
    expect(state).toEqual(createEmptyWorkspaceState());
  });

  test("creates, completes, and deletes inbox entries idempotently", () => {
    const pending = { id: "entry-a", createdAt: "2026-01-01T00:00:00.000Z" };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "inbox.entry.upserted",
      entry: pending,
    });

    expect(reduceWorkspaceState(state, { type: "inbox.entry.upserted", entry: pending })).toBe(
      state,
    );

    const completed = { ...pending, message: "Background work finished", artifact: "report.md" };
    state = reduceWorkspaceState(state, {
      type: "inbox.entry.upserted",
      entry: completed,
    });
    expect(state.inboxEntries).toEqual([completed]);

    state = reduceWorkspaceState(state, { type: "inbox.entry.deleted", entryId: pending.id });
    expect(state.inboxEntries).toEqual([]);
  });

  test("tracks artifact comment session links idempotently", () => {
    const commentSession = {
      sessionId: "comment-session-a",
      sourceSessionId: sessionId,
      path: "plan.md",
      threadId: "thread-a",
    };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "artifact.comment_session.linked",
      commentSession,
    });

    expect(state.artifactCommentSessions).toEqual([commentSession]);
    expect(
      reduceWorkspaceState(state, { type: "artifact.comment_session.linked", commentSession }),
    ).toBe(state);

    state = reduceWorkspaceState(state, {
      type: "artifact.comment_session.unlinked",
      sessionId: commentSession.sessionId,
    });
    expect(state.artifactCommentSessions).toEqual([]);
    expect(
      reduceWorkspaceState(state, {
        type: "artifact.comment_session.unlinked",
        sessionId: commentSession.sessionId,
      }),
    ).toBe(state);
  });

  test("registers and updates custom artifact kinds idempotently", () => {
    const kind = {
      name: "json-tree",
      extensions: ["json"],
      icon: "json",
      editable: false,
      html: "<html>first</html>",
    };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "artifact.kind.registered",
      kind,
    });

    expect(state.customArtifacts).toEqual([kind]);
    expect(reduceWorkspaceState(state, { type: "artifact.kind.registered", kind })).toBe(state);

    const updated = { ...kind, editable: true, html: "<html>updated</html>" };
    state = reduceWorkspaceState(state, { type: "artifact.kind.registered", kind: updated });
    expect(state.customArtifacts).toEqual([updated]);
  });
});

function transition(
  state: WorkspaceSessionState | undefined,
  event: WorkspaceSessionEvent,
): WorkspaceSessionState | undefined {
  return reduceWorkspaceSessionState(state, event);
}
