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
  test("stores activity and the shared prompt in one record", () => {
    const sessionId = `workspace-session-${crypto.randomUUID()}`;
    const now = Date.now();
    onTestFinished(() => clean(sessionId));

    const prompt = setSessionPrompt(sessionId, "hello", "client-a", now);

    expect(prompt).toEqual({ text: "hello", origin: "client-a", updatedAt: now });
    expect(getSessionState(sessionId)).toEqual({
      status: "idle",
      prompt: { text: "hello", origin: "client-a", updatedAt: now },
    });
    expect(getSessionStates()[sessionId]).toEqual({
      status: "idle",
      prompt: { text: "hello", origin: "client-a", updatedAt: now },
    });
  });

  test("applies the latest client value and ignores its repeated update", () => {
    const sessionId = `workspace-prompt-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    expect(setSessionPrompt(sessionId, "hello", "client-a", 1)).not.toBeNull();
    expect(setSessionPrompt(sessionId, "hello", "client-a", 2)).toBeNull();
    expect(setSessionPrompt(sessionId, "hello", "client-b", 3)).toEqual({
      text: "hello",
      origin: "client-b",
      updatedAt: 3,
    });
    expect(getSessionState(sessionId, 3)).toEqual({
      status: "idle",
      prompt: { text: "hello", origin: "client-b", updatedAt: 3 },
    });
  });

  test("expires idle prompts without retaining workspace activity", () => {
    const sessionId = `workspace-artifact-draft-${crypto.randomUUID()}`;
    onTestFinished(() => clean(sessionId));

    setSessionPrompt(sessionId, "old", "client-a", 1);

    expect(getSessionState(sessionId, DAY_MS + 2)).toBeUndefined();
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
