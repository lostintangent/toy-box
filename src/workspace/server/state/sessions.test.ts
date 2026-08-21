import { describe, expect, onTestFinished, test } from "bun:test";
import {
  applySessionState,
  deleteSessionState,
  getSessionState,
  getSessionStates,
  setSessionPrompt,
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
      type: "session.drafted",
      sessionId,
      createdAt: now,
    });
    const prompt = setSessionPrompt(sessionId, "hello", "client-a", now);

    expect(prompt).toEqual({ text: "hello", origin: "client-a", updatedAt: now });
    expect(getSessionState(sessionId)).toEqual({
      status: "draft",
      createdAt: now,
      prompt: { text: "hello", origin: "client-a", updatedAt: now },
    });
    expect(getSessionStates()[sessionId]).toEqual({
      status: "draft",
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

  test("expires old prompts without dropping an artifact-backed draft", () => {
    const sessionId = `workspace-artifact-draft-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    applySessionState({
      type: "session.drafted",
      sessionId,
      createdAt: 1,
      artifactPath: "document.md",
    });
    setSessionPrompt(sessionId, "old", "client-a", 1);

    expect(getSessionState(sessionId, DAY_MS + 2)).toEqual({
      status: "draft",
      createdAt: 1,
      artifactPath: "document.md",
    });
  });

  test("expires old prompts without dropping live status", () => {
    const sessionId = `workspace-expiring-prompt-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    setSessionPrompt(sessionId, "old", "client-a", 1);
    applySessionState({ type: "session.waiting", sessionId });

    expect(getSessionState(sessionId, DAY_MS + 2)).toEqual({ status: "waiting" });
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
