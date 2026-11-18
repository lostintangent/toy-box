import { afterAll, beforeEach, describe, expect, mock, onTestFinished, test } from "bun:test";
import { join } from "node:path";
import * as runtimeWorkersModule from "./supervisor";
import type { WorkerSpawn } from "./supervisor";
import { createWorker } from "./database";
import type { WorkerOwner } from "../model";
import { waitForSessions } from "@sessions/server/runtime";
import { sessionFile } from "@files/model";
import * as filePathsModule from "@files/server/paths";
import { openTestDatabase } from "@/server/testFixtures";
import { AppDatabase } from "@apps/server/database";
import type { SessionCompletion } from "@sessions/model";
import type { WorkspaceEvent } from "@workspace/model/events";

const realRuntimeWorkersModule = { ...runtimeWorkersModule };
const realFilePathsModule = { ...filePathsModule };

type Spawn = WorkerSpawn<WorkerOwner, unknown>;
const workerFor = ({ owner, retention, name, metadata, sessionId }: Spawn) =>
  createWorker({ ...owner, ephemeral: retention === "ephemeral", name, metadata }, sessionId);

let completions: Promise<SessionCompletion>[];
/** Spawns like the real supervisor: the run is registered at once and admission
 *  resolves, while execution settles with the next queued completion. */
async function spawn(input: Spawn) {
  const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
  const worker = workerFor(input);
  void startWorkerRun(worker, () => completion).catch(() => {});
  return { sessionId: worker.sessionId, value: await input.admit?.(worker) };
}
const spawnWorkerMock = mock(spawn);

mock.module("@workers/server/supervisor", () => ({
  ...realRuntimeWorkersModule,
  spawnWorker: spawnWorkerMock,
}));
mock.module("@files/server/paths", () => ({
  ...realFilePathsModule,
  resolveWorkspaceFile: (file: { path: string }) =>
    file.path === "other.csv"
      ? join(import.meta.dir, "../../../../package.json")
      : import.meta.path,
}));

const { spawnWorkerFromRequest, buildWorkerPrompt, cancelWorkerFromRequest } =
  await import("./admission");
const { getActiveWorker, startWorkerRun } = await import("./registry");
const { subscribeWorkspaceEvents } = await import("@workspace/server/events");

afterAll(() => {
  mock.module("@workers/server/supervisor", () => realRuntimeWorkersModule);
  mock.module("@files/server/paths", () => realFilePathsModule);
});

beforeEach(() => {
  completions = [];
  spawnWorkerMock.mockClear();
  spawnWorkerMock.mockImplementation(spawn);
});

const file = sessionFile("toy-box-parent", "report.csv");
const input = {
  type: "file" as const,
  file,
  name: "Generate row 18",
  message: { content: "Append one generated row that matches the existing headers." },
  metadata: { type: "generate-row", placeholderId: "row-a" },
};

describe("workers", () => {
  test.each(["file", "app"] as const)(
    "%s spawning waits for durable admission, not execution",
    async (owner) => {
      const db = await openTestDatabase();
      const app = await new AppDatabase(db).create({
        definitionId: "regex",
        title: "Admission test",
        color: "#8b5cf6",
        state: {},
      });
      const admission = Promise.withResolvers<{ sessionId: string; value: unknown }>();
      spawnWorkerMock.mockImplementationOnce(() => admission.promise);
      const spawning =
        owner === "file"
          ? spawnWorkerFromRequest(input)
          : spawnWorkerFromRequest({ type: "app", appId: app.id, message: input.message });
      let returned = false;
      void spawning.then(() => {
        returned = true;
      });
      await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
      expect(returned).toBe(false);

      admission.resolve({ sessionId: "admitted", value: undefined });
      expect((await spawning).sessionId).toBe("admitted");
    },
  );

  test("returns after admission and projects opaque metadata through workspace events", async () => {
    const completion = Promise.withResolvers<SessionCompletion>();
    completions.push(completion.promise);
    const events: WorkspaceEvent[] = [];
    let eventWait: Promise<SessionCompletion[]> | undefined;
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (!event.type.startsWith("worker.")) return;
      events.push(event);
      if (event.type === "worker.started") {
        eventWait = waitForSessions([event.worker.sessionId]);
      }
    });
    onTestFinished(unsubscribe);

    const { sessionId } = await spawnWorkerFromRequest(input);

    expect(getActiveWorker(sessionId)).toBeDefined();
    expect(events).toEqual([
      {
        type: "worker.started",
        worker: {
          createdAt: expect.any(String),
          type: "file",
          sessionId,
          ephemeral: true,
          file,
          name: input.name,
          metadata: input.metadata,
        },
      },
    ]);

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock).toHaveBeenCalledWith({
      owner: { type: "file", file },
      name: input.name,
      metadata: input.metadata,
      message: { content: expect.stringContaining(input.message.content) },
      location: undefined,
      retention: "ephemeral",
    });
    expect(spawnWorkerMock.mock.calls[0]![0].message.content).toContain(import.meta.path);

    completion.resolve({ status: "completed" });
    await expect(eventWait).resolves.toEqual([{ status: "completed" }]);
    await waitFor(() => expect(getActiveWorker(sessionId)).toBeUndefined());
    expect(events.at(-1)).toEqual({ type: "worker.finished", sessionId });
  });

  test("adds the scoped app state contract to an existing app's task", async () => {
    const db = await openTestDatabase();
    const app = await new AppDatabase(db).create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: { pattern: "", flags: "", testText: "1.2.3" },
    });
    const completion = Promise.withResolvers<SessionCompletion>();
    completions.push(completion.promise);

    const worker = await spawnWorkerFromRequest({
      type: "app",
      appId: app.id,
      message: {
        content: "Generate a semantic-version expression.",
        model: { provider: "copilot", name: "gpt-5" },
      },
      location: { directory: "/repo", useWorktree: true },
    });

    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(1));
    expect(spawnWorkerMock.mock.calls[0]![0]).toMatchObject({
      owner: { type: "app", appId: app.id },
      retention: "ephemeral",
      message: { model: { provider: "copilot", name: "gpt-5" } },
      location: { directory: "/repo", useWorktree: true },
    });
    const prompt = spawnWorkerMock.mock.calls[0]![0].message.content;
    expect(prompt).toContain(`app instance ID is "${app.id}"`);
    expect(prompt).toContain("tools are scoped to this owning app");
    expect(prompt).not.toContain('"testText": "1.2.3"');
    expect(prompt).not.toContain(`current revision is ${app.revision}`);
    expect(prompt).toContain("Generate a semantic-version expression.");

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(getActiveWorker(worker.sessionId)).toBeUndefined());
  });

  test("allows workers for the same app to execute concurrently", async () => {
    const db = await openTestDatabase();
    const app = await new AppDatabase(db).create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: { pattern: "current" },
    });
    const first = Promise.withResolvers<SessionCompletion>();
    const second = Promise.withResolvers<SessionCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnWorkerFromRequest({
      type: "app",
      appId: app.id,
      message: { content: "First task." },
    });
    const secondWorker = await spawnWorkerFromRequest({
      type: "app",
      appId: app.id,
      ephemeral: false,
      message: { content: "Second task." },
    });

    expect(
      [firstWorker, secondWorker].map(({ sessionId }) => getActiveWorker(sessionId) !== undefined),
    ).toEqual([true, true]);
    expect(spawnWorkerMock.mock.calls.map(([request]) => request.retention)).toEqual([
      "ephemeral",
      "durable",
    ]);

    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(getActiveWorker(secondWorker.sessionId)).toBeUndefined());
  });

  test("rejects an app worker whose app is deleted before admission", async () => {
    const db = await openTestDatabase();
    const apps = new AppDatabase(db);
    const app = await apps.create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: {},
    });
    spawnWorkerMock.mockImplementationOnce(async (input) => {
      await apps.delete(app.id);
      await input.admit?.(workerFor(input));
      throw new Error("A rejected admission must not start its worker.");
    });

    await expect(
      spawnWorkerFromRequest({
        type: "app",
        appId: app.id,
        message: { content: "Generate a pattern." },
      }),
    ).rejects.toThrow("The app was deleted before its worker started.");
  });

  test("rejects workers for missing apps", async () => {
    await openTestDatabase();

    await expect(
      spawnWorkerFromRequest({
        type: "app",
        appId: "missing-app",
        message: { content: "Generate a pattern." },
      }),
    ).rejects.toThrow("existing app");
    expect(spawnWorkerMock).not.toHaveBeenCalled();
  });

  test("cancels one concurrent file worker without affecting its sibling", async () => {
    const first = Promise.withResolvers<SessionCompletion>();
    const second = Promise.withResolvers<SessionCompletion>();
    completions.push(first.promise, second.promise);

    const firstWorker = await spawnWorkerFromRequest(input);
    const secondWorker = await spawnWorkerFromRequest({
      ...input,
      metadata: { placeholderId: "row-b" },
    });
    await waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledTimes(2));

    await expect(
      cancelWorkerFromRequest({ type: "file", file, workerSessionId: firstWorker.sessionId }),
    ).resolves.toBe(true);
    expect(getActiveWorker(firstWorker.sessionId)).toBeUndefined();
    expect(getActiveWorker(secondWorker.sessionId)).toBeDefined();

    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(getActiveWorker(secondWorker.sessionId)).toBeUndefined());
  });

  test("does not cancel a worker through a different file", async () => {
    const completion = Promise.withResolvers<SessionCompletion>();
    completions.push(completion.promise);
    const worker = await spawnWorkerFromRequest(input);

    await expect(
      cancelWorkerFromRequest({
        type: "file",
        file: sessionFile("toy-box-parent", "other.csv"),
        workerSessionId: worker.sessionId,
      }),
    ).resolves.toBe(false);
    expect(getActiveWorker(worker.sessionId)).toBeDefined();

    completion.resolve({ status: "completed" });
  });

  test("rejects failed admission without interrupting an active sibling", async () => {
    const completion = Promise.withResolvers<SessionCompletion>();
    completions.push(completion.promise);
    const sibling = await spawnWorkerFromRequest(input);
    onTestFinished(() => completion.resolve({ status: "completed" }));
    expect(getActiveWorker(sibling.sessionId)).toBeDefined();

    spawnWorkerMock.mockRejectedValueOnce(new Error("Unable to spawn."));
    await expect(
      spawnWorkerFromRequest({
        ...input,
        metadata: { placeholderId: "row-b" },
      }),
    ).rejects.toThrow("Unable to spawn.");
    expect(getActiveWorker(sibling.sessionId)).toBeDefined();

    completion.resolve({ status: "completed", response: "Sibling result" });
    await expect(waitForSessions([sibling.sessionId])).resolves.toEqual([
      { status: "completed", response: "Sibling result" },
    ]);
    expect(getActiveWorker(sibling.sessionId)).toBeUndefined();
  });
});

describe("worker prompt", () => {
  test("grounds the file task in its resolved path", () => {
    const prompt = buildWorkerPrompt("Append one CSV row.", {
      type: "file",
      absolutePath: "/tmp/session/files/report.csv",
    });

    expect(prompt).toContain("/tmp/session/files/report.csv");
    expect(prompt).toContain("Append one CSV row.");
  });
});

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (cause) {
      error = cause;
      await Bun.sleep(5);
    }
  }
  throw error;
}
