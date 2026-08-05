import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { createTestDatabase } from "../database";
import { deleteHyperState } from "./hyperSessions";
import { deleteSessionState, getSessionState } from "./sessions";
import type { Automation, WorkspaceEvent } from "@/types";
import { sessionFile } from "@/lib/files/workspaceFile";

let currentDb: Bun.SQL | undefined;

mock.module("../database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const {
  addDraftSession,
  applyWorkspaceAction,
  changeSettings,
  createPendingInboxEntry,
  deleteInboxEntry,
  deleteSessionWorkspaceState,
  finishWorker,
  getWorkspaceState,
  sendToInbox,
  setSessionStatus,
  startWorker,
  unpinSession,
} = await import(".");
const { persistDraftSession } = await import("../session/drafts");
const { deleteInboxEntryState } = await import("./inbox");

async function openWorkspaceTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
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
    customEditors: [],
    appDefinitions: [],
    apps: [],
    appShares: [],
    environment: { voiceEnabled: false },
  });
}

describe("workspace state", () => {
  test("merges precise settings updates before broadcasting their complete value", async () => {
    await openWorkspaceTestDatabase();
    const initial = {
      ...(await snapshot()).settings,
      defaultModel: { name: "gpt-5", reasoningEffort: "high" },
      terminalShell: "/bin/zsh",
      pinnedSessionIds: ["session-a"],
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

  test("deleting a session drops only its own pin", async () => {
    await openWorkspaceTestDatabase();
    await changeSettings({ pinnedSessionIds: ["kept", "deleted"] });

    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === "settings.changed") events.push(event);
    });
    onTestFinished(unsubscribe);

    await unpinSession("deleted");
    expect((await snapshot()).settings.pinnedSessionIds).toEqual(["kept"]);

    // Deleting a session that was never pinned commits and broadcasts nothing.
    await unpinSession("never-pinned");
    expect(events).toHaveLength(1);
  });

  test("snapshot exposes one canonical session-state map", async () => {
    const sessionId = `workspace-snapshot-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));

    addDraftSession({ sessionId, createdAt: 0 }, true);
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

  test("projects durable artifact drafts into snapshots without caching them", async () => {
    await openWorkspaceTestDatabase();
    const draft = {
      sessionId: `workspace-draft-${crypto.randomUUID()}`,
      artifactPath: "document.md",
      createdAt: 42,
    };
    onTestFinished(() => cleanup(draft.sessionId));
    await persistDraftSession(draft);

    expect(getSessionState(draft.sessionId)).toBeUndefined();
    expect((await snapshot()).sessionStates[draft.sessionId]).toEqual({
      status: "draft",
      artifactPath: draft.artifactPath,
      createdAt: draft.createdAt,
    });
    expect(getSessionState(draft.sessionId)).toBeUndefined();
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

  test("activity statuses broadcast only real transitions", () => {
    const sessionId = `workspace-status-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));
    const events = capture(sessionId);

    setSessionStatus(sessionId, "running");
    setSessionStatus(sessionId, "running");
    setSessionStatus(sessionId, "unread");
    setSessionStatus(sessionId, "unread");
    applyWorkspaceAction({ type: "session.read", sessionId });
    applyWorkspaceAction({ type: "session.read", sessionId });

    expect(events.map((event) => event.type)).toEqual([
      "session.running",
      "session.unread",
      "session.read",
    ]);
    expect(getSessionState(sessionId)).toBeUndefined();
  });

  test("snapshots and broadcasts worker links", async () => {
    const worker = {
      type: "file" as const,
      sessionId: `artifact-worker-${crypto.randomUUID()}`,
      ephemeral: true,
      file: sessionFile(`artifact-source-${crypto.randomUUID()}`, "plan.md"),
      name: "Respond to comment",
      metadata: { threadId: "thread-a" },
    };
    onTestFinished(() => finishWorker(worker.sessionId));
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (
        (event.type === "worker.started" && event.worker.sessionId === worker.sessionId) ||
        (event.type === "worker.finished" && event.sessionId === worker.sessionId)
      ) {
        events.push(event);
      }
    });
    onTestFinished(unsubscribe);

    startWorker(worker);
    startWorker({ ...worker, metadata: { ignored: true } });
    expect((await snapshot()).workers).toEqual([worker]);

    finishWorker(worker.sessionId);
    finishWorker(worker.sessionId);
    expect((await snapshot()).workers).toEqual([]);
    expect(events).toEqual([
      { type: "worker.started", worker },
      {
        type: "worker.finished",
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
    const entry = await sendToInbox(sessionId, message, "report.md");
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
    const entry = await sendToInbox(sessionId, "Report ready", "report.md");
    onTestFinished(() => deleteInboxEntryState(entry.id));

    deleteSessionWorkspaceState(sessionId);

    expect((await snapshot()).inboxEntries).toContainEqual(entry);
  });
});
