import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import type { WorkspaceEvent } from "@/types";
import {
  createDraft,
  deleteDraftPromptState,
  deleteDraftState,
  deleteHyperState,
  deleteUnreadState,
  discardDraft,
  getDraftPrompt,
  getWorkspaceState,
  markSessionHyper,
  markSessionRead,
  markSessionUnread,
  setDraftPrompt,
  sweepExpiredDrafts,
} from ".";

const DAY_MS = 24 * 60 * 60 * 1000;

function captureWorkspaceEvents(sessionId: string): WorkspaceEvent[] {
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

function cleanup(sessionId: string): void {
  deleteDraftState(sessionId);
  deleteDraftPromptState(sessionId);
  deleteHyperState(sessionId);
  deleteUnreadState(sessionId);
}

describe("workspace state", () => {
  test("snapshot combines stored workspace facts with caller-owned running projection", () => {
    const sessionId = `workspace-snapshot-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));

    const draft = createDraft(sessionId);
    setDraftPrompt(sessionId, "hello", "client-a");
    markSessionUnread(sessionId);
    markSessionHyper(sessionId);

    const state = getWorkspaceState({ runningSessionIds: [sessionId], customArtifacts: [] });

    expect(state.drafts).toContainEqual(draft);
    expect(state.draftPromptsBySessionId[sessionId]).toMatchObject({
      text: "hello",
      origin: "client-a",
    });
    expect(state.unreadSessionIds).toContain(sessionId);
    expect(state.hyperSessionIds).toContain(sessionId);
    expect(state.runningSessionIds).toEqual([sessionId]);
  });

  test("discard is guarded by draft membership and cascades prompt and hyper cleanup", () => {
    const sessionId = `workspace-discard-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = captureWorkspaceEvents(sessionId);

    createDraft(sessionId);
    setDraftPrompt(sessionId, "discard me", "client-a");
    markSessionHyper(sessionId);

    discardDraft(sessionId);
    // Second discard is a no-op — proven by the single draft.discarded event below.
    discardDraft(sessionId);
    expect(getDraftPrompt(sessionId)).toBeNull();
    expect(
      getWorkspaceState({ runningSessionIds: [], customArtifacts: [] }).hyperSessionIds,
    ).not.toContain(sessionId);
    expect(events.map((event) => event.type)).toEqual([
      "session.draft.created",
      "session.prompt.drafted",
      "session.hyper.created",
      "session.draft.discarded",
    ]);
  });

  test("stale discard leaves prompt and hyper state intact", () => {
    const sessionId = `workspace-stale-discard-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));

    createDraft(sessionId);
    setDraftPrompt(sessionId, "keep me", "client-a");
    markSessionHyper(sessionId);
    deleteDraftState(sessionId);

    // Draft record already gone: discard is a stale no-op that must not cascade.
    discardDraft(sessionId);
    expect(getDraftPrompt(sessionId)).toMatchObject({ text: "keep me", origin: "client-a" });
    expect(
      getWorkspaceState({ runningSessionIds: [], customArtifacts: [] }).hyperSessionIds,
    ).toContain(sessionId);
  });

  test("draft TTL sweep silently cascades prompt and hyper cleanup", () => {
    const sessionId = `workspace-expired-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = captureWorkspaceEvents(sessionId);

    createDraft(sessionId);
    setDraftPrompt(sessionId, "expire me", "client-a");
    markSessionHyper(sessionId);

    expect(sweepExpiredDrafts(Date.now() + DAY_MS + 1)).toContain(sessionId);
    expect(getDraftPrompt(sessionId)).toBeNull();
    expect(
      getWorkspaceState({ runningSessionIds: [], customArtifacts: [] }).hyperSessionIds,
    ).not.toContain(sessionId);
    expect(events.map((event) => event.type)).toEqual([
      "session.draft.created",
      "session.prompt.drafted",
      "session.hyper.created",
    ]);
  });

  test("read and unread membership emit only on real transitions", () => {
    const sessionId = `workspace-unread-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = captureWorkspaceEvents(sessionId);

    markSessionUnread(sessionId);
    markSessionUnread(sessionId);
    markSessionRead(sessionId);
    markSessionRead(sessionId);

    expect(events).toEqual([
      { type: "session.unread", sessionId },
      { type: "session.read", sessionId },
    ]);
  });
});
