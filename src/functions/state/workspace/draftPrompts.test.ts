import { describe, expect, onTestFinished, test } from "bun:test";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { clearDraftPrompt, deleteDraftPromptState, getDraftPrompt, setDraftPrompt } from ".";
import type { WorkspaceEvent } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function capturePromptEvents(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (event.type === "session.prompt.drafted" && event.sessionId === sessionId) {
      events.push(event);
    }
  });
  onTestFinished(unsubscribe);
  return events;
}

describe("draft prompt state", () => {
  test("sets prompts idempotently and clears with the server origin", () => {
    const sessionId = `prompt-set-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteDraftPromptState(sessionId);
    });
    const events = capturePromptEvents(sessionId);

    setDraftPrompt(sessionId, "hello", "client-a");
    setDraftPrompt(sessionId, "hello", "client-a");
    setDraftPrompt(sessionId, "hello", "client-b");
    clearDraftPrompt(sessionId);
    setDraftPrompt(sessionId, "", "client-a");
    clearDraftPrompt(sessionId);

    expect(getDraftPrompt(sessionId)?.text).toBe("");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "session.prompt.drafted",
      sessionId,
      prompt: { text: "hello", origin: "client-a" },
    });
    expect(events[1]).toMatchObject({
      type: "session.prompt.drafted",
      sessionId,
      prompt: { text: "", origin: DRAFT_PROMPT_SERVER_ORIGIN },
    });
  });

  test("silent deletion and TTL expiry do not emit prompt change events", () => {
    const deletedId = `prompt-delete-${crypto.randomUUID()}`;
    const expiredId = `prompt-expired-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteDraftPromptState(deletedId);
      deleteDraftPromptState(expiredId);
    });
    const deletedEvents = capturePromptEvents(deletedId);
    const expiredEvents = capturePromptEvents(expiredId);

    setDraftPrompt(deletedId, "delete me", "client-a");
    expect(deleteDraftPromptState(deletedId)).toBe(true);

    setDraftPrompt(expiredId, "expire me", "client-a");
    expect(getDraftPrompt(expiredId, Date.now() + DAY_MS + 1)).toBeNull();

    expect(deletedEvents.map((event) => event.type)).toEqual(["session.prompt.drafted"]);
    expect(expiredEvents.map((event) => event.type)).toEqual(["session.prompt.drafted"]);
  });
});
