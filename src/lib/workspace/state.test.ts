import { describe, expect, test } from "bun:test";
import {
  createEmptyWorkspaceState,
  reduceWorkspaceState,
  selectDraftPrompt,
  type WorkspaceState,
} from "./state";

function seededWorkspaceState(): WorkspaceState {
  return {
    drafts: [{ sessionId: "draft-a", createdAt: 1, updatedAt: 2 }],
    draftPromptsBySessionId: {
      "draft-a": { text: "hello", origin: "client-a", updatedAt: 3 },
    },
    unreadSessionIds: ["draft-a"],
    hyperSessionIds: ["draft-a"],
    runningSessionIds: ["draft-a"],
    customArtifacts: [],
  };
}

describe("workspace state reducer", () => {
  test("tracks draft, prompt, unread, hyper, and running actions idempotently", () => {
    let state = createEmptyWorkspaceState();
    const draft = { sessionId: "draft-a", createdAt: 1, updatedAt: 2 };
    const prompt = { text: "hello", origin: "client-a", updatedAt: 3 };

    state = reduceWorkspaceState(state, { type: "session.draft.created", draft });
    state = reduceWorkspaceState(state, {
      type: "session.prompt.drafted",
      sessionId: "draft-a",
      prompt,
    });
    state = reduceWorkspaceState(state, { type: "session.unread", sessionId: "draft-a" });
    state = reduceWorkspaceState(state, { type: "session.hyper.created", sessionId: "draft-a" });
    state = reduceWorkspaceState(state, { type: "session.running", sessionId: "draft-a" });

    const duplicate = reduceWorkspaceState(state, {
      type: "session.running",
      sessionId: "draft-a",
    });

    expect(duplicate).toBe(state);
    expect(state.drafts).toEqual([draft]);
    expect(selectDraftPrompt(state, "draft-a")).toEqual(prompt);
    expect(state.unreadSessionIds).toEqual(["draft-a"]);
    expect(state.hyperSessionIds).toEqual(["draft-a"]);
    expect(state.runningSessionIds).toEqual(["draft-a"]);
  });

  test("discard removes draft, prompt, and hyper without touching unread or running", () => {
    const state = reduceWorkspaceState(seededWorkspaceState(), {
      type: "session.draft.discarded",
      sessionId: "draft-a",
    });

    expect(state.drafts).toEqual([]);
    expect(state.draftPromptsBySessionId).toEqual({});
    expect(state.hyperSessionIds).toEqual([]);
    expect(state.unreadSessionIds).toEqual(["draft-a"]);
    expect(state.runningSessionIds).toEqual(["draft-a"]);
  });

  test("upsert removes only draft membership", () => {
    const state = reduceWorkspaceState(seededWorkspaceState(), {
      type: "session.upserted",
      session: { sessionId: "draft-a" },
    });

    expect(state.drafts).toEqual([]);
    expect(selectDraftPrompt(state, "draft-a")).toMatchObject({ text: "hello" });
    expect(state.hyperSessionIds).toEqual(["draft-a"]);
    expect(state.unreadSessionIds).toEqual(["draft-a"]);
    expect(state.runningSessionIds).toEqual(["draft-a"]);
  });

  test("delete clears every workspace fact for the session", () => {
    const state = reduceWorkspaceState(seededWorkspaceState(), {
      type: "session.deleted",
      sessionId: "draft-a",
    });

    expect(state).toEqual(createEmptyWorkspaceState());
  });
});
