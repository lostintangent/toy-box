import { expect, onTestFinished, spyOn, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import * as state from "@/server/database";
import * as sessionRuntime from "@sessions/server/runtime";
import * as workers from "@workers/server";
import { sharedMap } from "@/shared/server/processState";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import { getWorker, listWorkers, updateWorker } from "@workers/server";
import { WorkerDatabase, registerWorkerSession } from "@workers/server/database";
import { detachManagedSession } from "@/server/managedSessions";
import { dispatchInboxTask } from "./dispatcher";
import { SMALL_JSON_MAX_BYTES } from "@/shared/smallJson";
import type { InboxEntry } from "../model";
import {
  deleteInboxEntry,
  ensureInboxRecovered,
  failInboxTask,
  getInboxEntry,
  listInboxEntries,
  sendToInbox,
} from "./index";

// Keep Inbox and Worker persistence real; control only the Session execution boundary.
async function openInbox() {
  const db = await state.createTestDatabase();
  const readDatabase = spyOn(state, "getStateDatabase").mockResolvedValue(db);
  sharedMap<Promise<void>>("inbox-recovery").clear();
  await ensureInboxRecovered();
  const completion = Promise.withResolvers<SessionCompletion>();
  const createSession = spyOn(sessionRuntime, "createSession").mockImplementation(async () => ({
    disposition: "started",
    waitForCompletion: () => completion.promise,
  }));
  const deleteSession = spyOn(sessionRuntime, "deleteSessionIfExists").mockImplementation(
    async (sessionId) => {
      await detachManagedSession(sessionId);
      return true;
    },
  );
  async function finish(result: SessionCompletion = { status: "completed" }) {
    completion.resolve(result);
    await Bun.sleep(0);
  }
  onTestFinished(async () => {
    await finish();
    createSession.mockRestore();
    deleteSession.mockRestore();
    readDatabase.mockRestore();
    await db.close();
  });
  return { db, createSession, finish };
}

test("configured tasks publish readable results and retain them until deletion", async () => {
  const { createSession, finish } = await openInbox();
  let announcedEntries: Promise<InboxEntry[]> = Promise.resolve([]);
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
      if (event.type === "inbox.changed" || event.type === "inbox.entry.deleted") {
        announcedEntries = listInboxEntries();
      }
    }),
  );
  const launch = {
    message: {
      content: "Research this",
      model: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
      attachments: [{ mimeType: "image/png", base64: "aGVsbG8=" }],
    },
    location: { directory: "/repo", useWorktree: true },
  } satisfies SessionLaunch;
  const { sessionId } = await dispatchInboxTask(launch);
  const pending = {
    id: sessionId,
    createdAt: expect.any(String),
    kind: "pending",
  } satisfies InboxEntry;
  expect(await announcedEntries).toEqual([pending]);
  await waitFor(async () => {
    expect(createSession).toHaveBeenCalledWith(
      sessionId,
      launch.message,
      expect.objectContaining({ ...launch.location, sessionType: "worker" }),
    );
  });

  const createdAt = (await getInboxEntry(sessionId))!.createdAt;
  await sendToInbox(sessionId, "Report ready", "report.md");
  const result = {
    id: sessionId,
    createdAt,
    kind: "result",
    message: "Report ready",
    artifact: "report.md",
  } satisfies InboxEntry;
  expect(await announcedEntries).toEqual([result]);
  await finish();
  expect(await listInboxEntries()).toEqual([result]);

  expect(await deleteInboxEntry(sessionId)).toBe(true);
  expect(await announcedEntries).toEqual([]);
  expect(await getWorker(sessionId, "inbox")).toBeNull();
});

test("clean completion without a result removes the entry and its Worker", async () => {
  const { finish } = await openInbox();
  const { sessionId } = await dispatchInboxTask({ message: { content: "Update files" } });
  await finish();
  await waitFor(async () => {
    expect(await getInboxEntry(sessionId)).toBeNull();
  });
  expect(await listWorkers("inbox")).toEqual([]);
});

test("unsuccessful completion retains a visible error", async () => {
  const { finish } = await openInbox();
  const { sessionId } = await dispatchInboxTask({ message: { content: "Try this" } });
  await finish({ status: "failed", error: "Provider rate limit exceeded" });
  await waitFor(async () => {
    expect(await getInboxEntry(sessionId)).toMatchObject({
      id: sessionId,
      kind: "error",
      error: expect.stringContaining("Provider rate limit exceeded"),
    });
  });
});

test("unreadable results survive completion and remain listable, repairable, and deletable", async () => {
  const { db, finish } = await openInbox();
  const store = new WorkerDatabase(db);
  for (const sessionId of ["valid", "oversized"]) {
    await store.create({
      type: "inbox",
      sessionId,
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
    });
  }
  await sendToInbox("valid", "Valid result");
  const { sessionId } = await dispatchInboxTask({ message: { content: "Keep this result" } });
  const createdAt = (await getInboxEntry(sessionId))!.createdAt;
  const invalid = { message: 42, artifact: "../outside.md" };
  await updateWorker(sessionId, { metadata: invalid });
  const oversized = JSON.stringify({ message: "x".repeat(SMALL_JSON_MAX_BYTES) });
  await db`UPDATE workers SET metadata = ${oversized} WHERE session_id = 'oversized'`;
  await finish();

  const entries = await listInboxEntries();
  expect(entries).toHaveLength(3);
  expect(entries.find(({ id }) => id === "valid")).toMatchObject({
    kind: "result",
    message: "Valid result",
  });
  for (const id of [sessionId, "oversized"]) {
    expect(entries.find((entry) => entry.id === id)).toEqual({
      id,
      createdAt: expect.any(String),
      kind: "error",
      error: expect.any(String),
    });
  }
  await failInboxTask(sessionId, "Later failure");
  expect((await getWorker(sessionId, "inbox"))?.metadata).toEqual(invalid);

  await sendToInbox(sessionId, "Repaired result");
  expect(await getInboxEntry(sessionId)).toEqual({
    id: sessionId,
    createdAt,
    kind: "result",
    message: "Repaired result",
  });
  expect(await deleteInboxEntry("oversized")).toBe(true);
  expect(await getInboxEntry("oversized")).toBeNull();
  expect(await listInboxEntries()).toHaveLength(2);
});

test("startup failure retains a visible error until explicit deletion", async () => {
  const { createSession } = await openInbox();
  createSession.mockRejectedValue(new Error("Provider unavailable"));
  const log = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => log.mockRestore());

  const { sessionId } = await dispatchInboxTask({ message: { content: "Try this" } });
  await waitFor(async () => {
    expect(await getInboxEntry(sessionId)).toEqual({
      id: sessionId,
      createdAt: expect.any(String),
      kind: "error",
      error: expect.stringContaining("Provider unavailable"),
    });
  });
  expect(await deleteInboxEntry(sessionId)).toBe(true);
  expect(await getInboxEntry(sessionId)).toBeNull();
});

test("recovery preserves outcomes and finishes before new reads or admissions", async () => {
  const { createSession, finish } = await openInbox();
  for (const sessionId of ["unfinished", "reported", "unreadable"]) {
    await registerWorkerSession({
      type: "inbox",
      sessionId,
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
    });
  }
  await sendToInbox("reported", "A durable result");
  await updateWorker("unreadable", { metadata: { message: 42 } });
  sharedMap<Promise<void>>("inbox-recovery").clear();

  const blocked = Promise.withResolvers<void>();
  const readWorkers = workers.listWorkers;
  const list = spyOn(workers, "listWorkers").mockImplementationOnce(async (type) => {
    await blocked.promise;
    return readWorkers(type);
  });
  onTestFinished(() => {
    blocked.resolve();
    list.mockRestore();
  });

  const admission = dispatchInboxTask({ message: { content: "New work" } });
  let readFinished = false;
  const snapshot = listInboxEntries().then((entries) => {
    readFinished = true;
    return entries;
  });
  await Bun.sleep(0);
  expect(createSession).not.toHaveBeenCalled();
  expect(readFinished).toBe(false);
  blocked.resolve();
  const [receipt, entries] = await Promise.all([admission, snapshot]);

  expect(entries.find(({ id }) => id === "unfinished")).toMatchObject({
    kind: "error",
    error: expect.stringContaining("interrupted"),
  });
  expect(await getInboxEntry("reported")).toMatchObject({
    kind: "result",
    message: "A durable result",
  });
  expect((await getWorker("unreadable", "inbox"))?.metadata).toEqual({ message: 42 });
  await ensureInboxRecovered();
  expect((await getInboxEntry(receipt.sessionId))?.kind).toBe("pending");
  await sendToInbox(receipt.sessionId, "New result");
  await finish();
});

test("failed recovery can be retried", async () => {
  await openInbox();
  sharedMap<Promise<void>>("inbox-recovery").clear();
  const list = spyOn(workers, "listWorkers")
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValue([]);
  onTestFinished(() => list.mockRestore());
  await expect(ensureInboxRecovered()).rejects.toThrow("Storage unavailable");
  await expect(ensureInboxRecovered()).resolves.toBeUndefined();
});

test("a reported result replaces an earlier failure and survives later failures", async () => {
  await openInbox();
  const sessionId = crypto.randomUUID();
  await registerWorkerSession({
    type: "inbox",
    sessionId,
    createdAt: new Date(0).toISOString(),
    ephemeral: false,
  });
  await failInboxTask(sessionId, "Task failed");
  expect((await getInboxEntry(sessionId))?.kind).toBe("error");
  await sendToInbox(sessionId, "Keep this result");
  await failInboxTask(sessionId, "Later failure");
  expect(await getInboxEntry(sessionId)).toEqual({
    id: sessionId,
    createdAt: new Date(0).toISOString(),
    kind: "result",
    message: "Keep this result",
  });
});

test("Inbox lists its Workers in creation order and scopes reads and deletion to its ownership", async () => {
  const { db } = await openInbox();
  const store = new WorkerDatabase(db);
  for (const [sessionId, time] of [
    ["older", 1],
    ["newer", 2],
  ] as const) {
    await store.create({
      type: "inbox",
      sessionId,
      createdAt: new Date(time).toISOString(),
      ephemeral: false,
    });
  }
  await store.create({
    type: "app",
    sessionId: "other-owner",
    createdAt: new Date(3).toISOString(),
    appId: "app",
    ephemeral: false,
  });
  expect((await listInboxEntries()).map(({ id }) => id)).toEqual(["newer", "older"]);
  expect(await getInboxEntry("other-owner")).toBeNull();
  expect(await deleteInboxEntry("other-owner")).toBe(false);
  expect(await getWorker("other-owner", "app")).not.toBeNull();
});

async function waitFor(assertion: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await Bun.sleep(5);
    }
  }
}
