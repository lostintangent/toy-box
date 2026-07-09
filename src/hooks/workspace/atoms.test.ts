import { describe, expect, onTestFinished, test } from "bun:test";
import { createStore } from "jotai";
import { createEmptyWorkspaceState } from "@/lib/workspace/state";
import {
  artifactCommentSessionsAtom,
  draftSessionStatesAtom,
  hasUnreadInboxAtom,
  hyperSessionIdAtom,
  inboxEntriesAtom,
  sessionPromptAtom,
  sessionRunningAtom,
  sessionStatusAtom,
  sessionUnreadAtom,
  workspaceStateAtom,
} from "./atoms";

describe("workspace session atoms", () => {
  test("projects one session without notifying it about another", () => {
    const store = createStore();
    const statusAtom = sessionStatusAtom("session-a");
    let statusUpdates = 0;
    onTestFinished(store.sub(statusAtom, () => statusUpdates++));

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-b": { status: "running" } },
    });
    expect(store.get(statusAtom)).toBe("idle");
    expect(statusUpdates).toBe(0);

    store.set(workspaceStateAtom, {
      ...store.get(workspaceStateAtom),
      sessionStates: {
        ...store.get(workspaceStateAtom).sessionStates,
        "session-a": { status: "running" },
      },
    });
    expect(store.get(statusAtom)).toBe("running");
    expect(statusUpdates).toBe(1);
  });

  test("status consumers ignore prompt-only updates", () => {
    const store = createStore();
    const statusAtom = sessionStatusAtom("session-a");
    let updates = 0;
    onTestFinished(store.sub(statusAtom, () => updates++));

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: {
        "session-a": {
          status: "running",
          prompt: { text: "first", origin: "client-a", updatedAt: 1 },
        },
      },
    });
    expect(updates).toBe(1);

    store.set(workspaceStateAtom, {
      ...store.get(workspaceStateAtom),
      sessionStates: {
        "session-a": {
          status: "running",
          prompt: { text: "second", origin: "client-a", updatedAt: 2 },
        },
      },
    });
    expect(store.get(statusAtom)).toBe("running");
    expect(updates).toBe(1);
  });

  test("prompt consumers ignore status-only updates", () => {
    const store = createStore();
    const promptAtom = sessionPromptAtom("session-a");
    const prompt = { text: "draft", origin: "client-a", updatedAt: 1 };
    let updates = 0;
    onTestFinished(store.sub(promptAtom, () => updates++));

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "draft", createdAt: 1, prompt } },
    });
    expect(updates).toBe(1);

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "creating", createdAt: 1, prompt } },
    });
    expect(store.get(promptAtom)).toBe(prompt);
    expect(updates).toBe(1);
  });

  test("running spans creation without exposing that handoff to boolean consumers", () => {
    const store = createStore();
    const runningAtom = sessionRunningAtom("session-a");
    const unreadAtom = sessionUnreadAtom("session-a");
    let runningUpdates = 0;
    onTestFinished(store.sub(runningAtom, () => runningUpdates++));

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "creating", createdAt: 1 } },
    });
    expect(store.get(runningAtom)).toBe(true);
    expect(store.get(unreadAtom)).toBe(false);
    expect(runningUpdates).toBe(1);

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "running" } },
    });
    expect(store.get(runningAtom)).toBe(true);
    expect(runningUpdates).toBe(1);

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      sessionStates: { "session-a": { status: "unread" } },
    });
    expect(store.get(runningAtom)).toBe(false);
    expect(store.get(unreadAtom)).toBe(true);
    expect(runningUpdates).toBe(2);
  });

  test("collection consumers ignore session details they do not expose", () => {
    const store = createStore();
    const entry = { id: "session-a", createdAt: "2026-01-01T00:00:00.000Z" };
    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      inboxEntries: [entry],
      sessionStates: { "session-a": { status: "running" } },
    });

    let draftUpdates = 0;
    let inboxUpdates = 0;
    let unreadUpdates = 0;
    onTestFinished(store.sub(draftSessionStatesAtom, () => draftUpdates++));
    onTestFinished(store.sub(inboxEntriesAtom, () => inboxUpdates++));
    onTestFinished(store.sub(hasUnreadInboxAtom, () => unreadUpdates++));

    store.set(workspaceStateAtom, {
      ...store.get(workspaceStateAtom),
      sessionStates: {
        "session-a": {
          status: "running",
          prompt: { text: "typing", origin: "client-a", updatedAt: 1 },
        },
      },
    });
    expect(draftUpdates).toBe(0);
    expect(inboxUpdates).toBe(0);
    expect(unreadUpdates).toBe(0);

    store.set(workspaceStateAtom, {
      ...store.get(workspaceStateAtom),
      sessionStates: { "session-a": { status: "unread" } },
    });
    expect(store.get(hasUnreadInboxAtom)).toBe(true);
    expect(draftUpdates).toBe(0);
    expect(inboxUpdates).toBe(0);
    expect(unreadUpdates).toBe(1);
  });
});

describe("artifact comment session atoms", () => {
  test("projects only one artifact's sessions without observing session state", () => {
    const store = createStore();
    const commentSession = {
      sessionId: "comment-session-a",
      sourceSessionId: "session-a",
      path: "plan.md",
      threadId: "thread-a",
    };
    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      artifactCommentSessions: [
        commentSession,
        {
          sessionId: "comment-session-b",
          sourceSessionId: "session-a",
          path: "other.md",
          threadId: "thread-b",
        },
      ],
    });

    const commentSessionsAtom = artifactCommentSessionsAtom("session-a", "plan.md");
    expect(store.get(commentSessionsAtom)).toEqual([
      { sessionId: "comment-session-a", threadId: "thread-a" },
    ]);

    let updates = 0;
    onTestFinished(store.sub(commentSessionsAtom, () => updates++));
    store.set(workspaceStateAtom, {
      ...store.get(workspaceStateAtom),
      sessionStates: { "comment-session-a": { status: "running" } },
    });
    expect(updates).toBe(0);
  });
});

describe("hyperSessionIdAtom", () => {
  test("projects the workspace-managed Hyper session", () => {
    const store = createStore();
    expect(store.get(hyperSessionIdAtom)).toBeUndefined();

    store.set(workspaceStateAtom, {
      ...createEmptyWorkspaceState(),
      hyperSessionIds: ["hyper-a"],
    });
    expect(store.get(hyperSessionIdAtom)).toBe("hyper-a");
  });
});
