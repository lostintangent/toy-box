import { describe, expect, onTestFinished, test } from "bun:test";
import {
  applySessionState,
  deleteSessionState,
  getSessionState,
  getSessionStates,
  isDraft,
  setSessionPrompt,
  sweepExpiredDrafts,
} from "./sessions";

const DAY_MS = 24 * 60 * 60 * 1000;

function clean(sessionId: string): void {
  deleteSessionState(sessionId);
}

describe("workspace session storage", () => {
  test("stores every session fact in one record", () => {
    const sessionId = `workspace-session-${crypto.randomUUID()}`;
    const now = Date.now();
    onTestFinished(() => clean(sessionId));

    applySessionState({
      type: "session.draft.created",
      sessionId,
      createdAt: now,
    });
    const prompt = setSessionPrompt(sessionId, "hello", "client-a", now);
    applySessionState({ type: "session.creating", sessionId });

    expect(prompt).toEqual({ text: "hello", origin: "client-a", updatedAt: now });
    expect(getSessionState(sessionId)).toEqual({
      status: "creating",
      createdAt: now,
      prompt: { text: "hello", origin: "client-a", updatedAt: now },
    });
    expect(getSessionStates()[sessionId]).toEqual({
      status: "creating",
      createdAt: now,
      prompt: { text: "hello", origin: "client-a", updatedAt: now },
    });
  });

  test("refreshes unchanged prompt text silently", () => {
    const sessionId = `workspace-prompt-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    expect(setSessionPrompt(sessionId, "hello", "client-a", 1)).not.toBeNull();
    expect(setSessionPrompt(sessionId, "hello", "client-b", 2)).toBeNull();
    expect(getSessionState(sessionId, 2)).toEqual({
      status: "idle",
      prompt: { text: "hello", origin: "client-a", updatedAt: 2 },
    });
  });

  test("expires draft freshness from the prompt timestamp", () => {
    const sessionId = `workspace-expiring-draft-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    applySessionState({
      type: "session.draft.created",
      sessionId,
      createdAt: 1,
    });
    setSessionPrompt(sessionId, "keep alive", "client-a", DAY_MS);

    expect(sweepExpiredDrafts(DAY_MS + 1)).not.toContain(sessionId);
    expect(sweepExpiredDrafts(DAY_MS * 2 + 1)).toContain(sessionId);
    expect(isDraft(sessionId)).toBe(false);
  });

  test("expires old prompts without dropping active status", () => {
    const sessionId = `workspace-expiring-prompt-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    setSessionPrompt(sessionId, "old", "client-a", 1);
    applySessionState({ type: "session.running", sessionId });

    expect(getSessionState(sessionId, DAY_MS + 2)).toEqual({ status: "running" });
  });

  test("deletes one record to clear status and prompt together", () => {
    const sessionId = `workspace-delete-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    setSessionPrompt(sessionId, "hello", "client-a");
    applySessionState({ type: "session.unread", sessionId });
    expect(deleteSessionState(sessionId)).toBe(true);
    expect(getSessionState(sessionId)).toBeUndefined();
  });
});
