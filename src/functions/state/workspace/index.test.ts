import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type { Database } from "db0";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { createTestDatabase } from "../database";
import { deleteHyperState } from "./hyperSessions";
import { deleteSessionState, getSessionState } from "./sessions";
import type { Automation, WorkspaceEvent } from "@/types";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;
let currentDb: Database | undefined;

mock.module("../database", () => ({
  getAppDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const {
  applyWorkspaceAction,
  changeSettings,
  createPendingInboxEntry,
  deleteInboxEntry,
  deleteSessionWorkspaceState,
  finishArtifactWorker,
  getWorkspaceState,
  sendToInbox,
  setSessionStatus,
  startArtifactWorker,
  sweepExpiredDrafts,
} = await import(".");
const { deleteInboxEntryState } = await import("./inbox");

async function openWorkspaceTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

function capture(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if ("sessionId" in event && event.sessionId === sessionId) events.push(event);
  });
  onTestFinished(unsubscribe);
  return events;
}

function cleanup(sessionId: string): void {
  deleteSessionState(sessionId);
  deleteHyperState(sessionId);
}

function snapshot(automations: Automation[] = []) {
  return getWorkspaceState({
    automations,
    customArtifacts: [],
    environment: { terminalWsPort: DEFAULT_TERMINAL_WS_PORT, voiceEnabled: false },
  });
}

describe("workspace state", () => {
  test("merges precise settings updates before broadcasting their complete value", async () => {
    await openWorkspaceTestDatabase();
    const initial = {
      ...(await snapshot()).settings,
      defaultModel: { name: "gpt-5", reasoningEffort: "high" },
      terminalShell: "/bin/zsh",
    };
    await changeSettings(initial);

    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === "settings.changed") events.push(event);
    });
    onTestFinished(unsubscribe);
    const settings = {
      ...initial,
      accentColor: "#123abc" as const,
    };

    expect(await changeSettings({ accentColor: settings.accentColor })).toEqual(settings);
    expect(await changeSettings({ accentColor: settings.accentColor })).toEqual(settings);

    expect((await snapshot()).settings).toEqual(settings);
    expect(events).toEqual([{ type: "settings.changed", settings }]);
  });

  test("serializes concurrent settings updates", async () => {
    await openWorkspaceTestDatabase();

    await Promise.all([
      changeSettings({ accentColor: "#123abc" }),
      changeSettings({ terminalShell: "/bin/fish" }),
    ]);

    expect((await snapshot()).settings).toMatchObject({
      accentColor: "#123abc",
      terminalShell: "/bin/fish",
    });
  });

  test("snapshot exposes one canonical session-state map", async () => {
    const sessionId = `workspace-snapshot-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));

    applyWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: 0,
      hyper: true,
    });
    applyWorkspaceAction({
      type: "session.prompt.drafted",
      sessionId,
      prompt: { text: "hello", origin: "client-a", updatedAt: 0 },
    });

    const state = await snapshot();
    expect(state.sessionStates[sessionId]).toMatchObject({
      status: "draft",
      prompt: { text: "hello", origin: "client-a" },
    });
    expect(state.hyperSessionIds).toContain(sessionId);
  });

  test("snapshot composes durable automation definitions", async () => {
    const automation: Automation = {
      id: "automation-a",
      title: "Daily summary",
      prompt: "Summarize repo status.",
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
      createdAt: "2026-02-14T00:00:00.000Z",
      updatedAt: "2026-02-14T00:00:00.000Z",
      nextRunAt: "2026-02-14T09:00:00.000Z",
    };

    expect((await snapshot([automation])).automations).toEqual([automation]);
  });

  test("discard removes the draft, prompt, and hyper membership in one transition", async () => {
    const sessionId = `workspace-discard-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = capture(sessionId);

    applyWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: 0,
      hyper: true,
    });
    applyWorkspaceAction({
      type: "session.prompt.drafted",
      sessionId,
      prompt: { text: "discard me", origin: "client-a", updatedAt: 0 },
    });
    applyWorkspaceAction({ type: "session.draft.discarded", sessionId });
    applyWorkspaceAction({ type: "session.draft.discarded", sessionId });

    expect(getSessionState(sessionId)).toBeUndefined();
    expect((await snapshot()).hyperSessionIds).not.toContain(sessionId);
    expect(events.map((event) => event.type)).toEqual([
      "session.draft.created",
      "session.prompt.drafted",
      "session.draft.discarded",
    ]);
  });

  test("draft expiry uses prompt activity and cascades hyper cleanup", async () => {
    const sessionId = `workspace-expired-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = capture(sessionId);

    applyWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: 0,
      hyper: true,
    });
    applyWorkspaceAction({
      type: "session.prompt.drafted",
      sessionId,
      prompt: { text: "expire me", origin: "client-a", updatedAt: 0 },
    });

    expect(sweepExpiredDrafts(Date.now() + DAY_MS + 1)).toContain(sessionId);
    expect(getSessionState(sessionId)).toBeUndefined();
    expect((await snapshot()).hyperSessionIds).not.toContain(sessionId);
    expect(events.map((event) => event.type)).toEqual([
      "session.draft.created",
      "session.prompt.drafted",
      "session.draft.discarded",
    ]);
  });

  test("creation and activity statuses broadcast only real transitions", () => {
    const sessionId = `workspace-status-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = capture(sessionId);

    applyWorkspaceAction({ type: "session.draft.created", sessionId, createdAt: 0 });
    setSessionStatus(sessionId, "creating");
    setSessionStatus(sessionId, "creating");
    setSessionStatus(sessionId, "running");
    setSessionStatus(sessionId, "unread");
    setSessionStatus(sessionId, "unread");
    applyWorkspaceAction({ type: "session.read", sessionId });
    applyWorkspaceAction({ type: "session.read", sessionId });

    expect(events.map((event) => event.type)).toEqual([
      "session.draft.created",
      "session.creating",
      "session.running",
      "session.unread",
      "session.read",
    ]);
    expect(getSessionState(sessionId)).toBeUndefined();
  });

  test("idle restores a draft when creation fails", () => {
    const sessionId = `workspace-creation-failure-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));

    applyWorkspaceAction({ type: "session.draft.created", sessionId, createdAt: 0 });
    setSessionStatus(sessionId, "creating");
    setSessionStatus(sessionId, "idle");

    expect(getSessionState(sessionId)).toEqual({
      status: "draft",
      createdAt: expect.any(Number),
    });
  });

  test("snapshots and broadcasts artifact worker links", async () => {
    const worker = {
      sessionId: `artifact-worker-${crypto.randomUUID()}`,
      sourceSessionId: `artifact-source-${crypto.randomUUID()}`,
      path: "plan.md",
      name: "Respond to comment",
      metadata: { threadId: "thread-a" },
    };
    onTestFinished(() => finishArtifactWorker(worker.sessionId));
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (
        (event.type === "artifact.worker.started" && event.worker.sessionId === worker.sessionId) ||
        (event.type === "artifact.worker.finished" && event.sessionId === worker.sessionId)
      ) {
        events.push(event);
      }
    });
    onTestFinished(unsubscribe);

    startArtifactWorker(worker);
    startArtifactWorker({ ...worker, metadata: { ignored: true } });
    expect((await snapshot()).artifactWorkers).toEqual([worker]);

    finishArtifactWorker(worker.sessionId);
    finishArtifactWorker(worker.sessionId);
    expect((await snapshot()).artifactWorkers).toEqual([]);
    expect(events).toEqual([
      { type: "artifact.worker.started", worker },
      {
        type: "artifact.worker.finished",
        sessionId: worker.sessionId,
      },
    ]);
  });

  test("inbox creation, completion, and deletion broadcast state-bearing transitions", async () => {
    await openWorkspaceTestDatabase();
    const sessionId = `toy-box-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const message = `inbox-${crypto.randomUUID()}`;
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === "inbox.entry.upserted" && event.entry.id === sessionId) events.push(event);
      if (event.type === "inbox.entry.deleted" && event.entryId === sessionId) events.push(event);
    });
    onTestFinished(unsubscribe);

    const pending = await createPendingInboxEntry(sessionId);
    const entry = await sendToInbox(sessionId, message, {
      filename: "report.md",
      content: "# Report",
    });
    onTestFinished(() => deleteInboxEntryState(entry.id));
    await deleteInboxEntry(entry.id);
    await deleteInboxEntry(entry.id);

    expect(entry.artifact).toBe("report.md");
    expect((await snapshot()).inboxEntries).toEqual([]);
    expect(events).toEqual([
      { type: "inbox.entry.upserted", entry: pending },
      { type: "inbox.entry.upserted", entry },
      { type: "inbox.entry.deleted", entryId: entry.id },
    ]);
  });

  test("inbox entries remain durable when transient session state is deleted", async () => {
    await openWorkspaceTestDatabase();
    const sessionId = `toy-box-${crypto.randomUUID()}`;
    await createPendingInboxEntry(sessionId);
    const entry = await sendToInbox(sessionId, "Report ready", {
      filename: "report.md",
      content: "# Report",
    });
    onTestFinished(() => deleteInboxEntryState(entry.id));

    deleteSessionWorkspaceState(sessionId);

    expect((await snapshot()).inboxEntries).toContainEqual(entry);
  });
});
