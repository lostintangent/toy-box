import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import {
  createDraft,
  deleteDraftState,
  discardDraft,
  getDrafts,
  isDraft,
  isDraftFresh,
  sweepExpiredDrafts,
  touchDraft,
} from ".";
import type { WorkspaceEvent } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function captureSessionEvents(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if ("sessionId" in event && event.sessionId === sessionId) {
      events.push(event);
      return;
    }
    if (event.type === "session.draft.created" && event.draft.sessionId === sessionId) {
      events.push(event);
    }
  });
  onTestFinished(unsubscribe);
  return events;
}

describe("draft state", () => {
  test("creates drafts idempotently and emits only on the primary transition", () => {
    const sessionId = `draft-create-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteDraftState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    const draft = createDraft(sessionId);
    const duplicate = createDraft(sessionId);

    expect(duplicate).toBe(draft);
    expect(isDraft(sessionId)).toBe(true);
    expect(getDrafts()).toContainEqual(draft);
    expect(events).toEqual([{ type: "session.draft.created", draft }]);
  });

  test("touch updates freshness without emitting and discard emits once", async () => {
    const sessionId = `draft-discard-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteDraftState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    const draft = createDraft(sessionId);
    expect(isDraftFresh(draft, draft.updatedAt + DAY_MS)).toBe(false);

    await Bun.sleep(2);
    touchDraft(sessionId);
    const touchedDraft = getDrafts().find((item) => item.sessionId === sessionId);

    expect(touchedDraft?.updatedAt).toBeGreaterThan(draft.updatedAt);
    expect(touchedDraft && isDraftFresh(touchedDraft, draft.updatedAt + DAY_MS)).toBe(true);
    discardDraft(sessionId);
    // Second discard is a no-op — proven by the single draft.discarded event below.
    discardDraft(sessionId);

    expect(events).toEqual([
      { type: "session.draft.created", draft },
      { type: "session.draft.discarded", sessionId },
    ]);
  });

  test("silent deletion and TTL sweep do not emit discard events", () => {
    const silentlyDeletedId = `draft-silent-${crypto.randomUUID()}`;
    const expiredId = `draft-expired-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteDraftState(silentlyDeletedId);
      deleteDraftState(expiredId);
    });
    const silentEvents = captureSessionEvents(silentlyDeletedId);
    const expiredEvents = captureSessionEvents(expiredId);

    createDraft(silentlyDeletedId);
    createDraft(expiredId);
    expect(deleteDraftState(silentlyDeletedId)).toBe(true);

    const expired = sweepExpiredDrafts(Date.now() + DAY_MS + 1);

    expect(expired).toContain(expiredId);
    expect(isDraft(silentlyDeletedId)).toBe(false);
    expect(isDraft(expiredId)).toBe(false);
    expect(silentEvents.map((event) => event.type)).toEqual(["session.draft.created"]);
    expect(expiredEvents.map((event) => event.type)).toEqual(["session.draft.created"]);
  });

  test("freshness is based on updatedAt and supports injected clocks", () => {
    const now = 100_000;
    expect(isDraftFresh({ sessionId: "fresh", createdAt: now, updatedAt: now }, now)).toBe(true);
    expect(
      isDraftFresh({ sessionId: "expired", createdAt: now - DAY_MS, updatedAt: now - DAY_MS }, now),
    ).toBe(false);
  });
});
