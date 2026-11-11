import { afterAll, beforeEach, describe, expect, mock, onTestFinished, test } from "bun:test";
import { join } from "node:path";
import * as runtimeWorkersModule from "./supervisor";
import { waitForSessions } from "@sessions/server/runtime";
import { sessionFile } from "@files/model";
import * as filePathsModule from "@files/server/paths";
import { openTestDatabase } from "@/server/testFixtures";
import { AppDatabase } from "@apps/server/database";
import type { SessionCompletion } from "@sessions/model";
import type { WorkspaceEvent } from "@workspace/model/events";

const realRuntimeWorkersModule = { ...runtimeWorkersModule };
const realFilePathsModule = { ...filePathsModule };

let completions: Promise<SessionCompletion>[];
/** Supervises like the real supervisor: the run is registered at once and admission
 *  resolves, while execution settles with the next queued completion. */
async function supervise(input: Parameters<typeof runtimeWorkersModule.superviseWorker>[0]) {
  const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
  void startWorkerRun(input.worker, () => completion).catch(() => {});
  return { sessionId: input.worker.sessionId, value: await input.admit?.() };
}
const superviseWorkerMock = mock(supervise);

mock.module("@workers/server/supervisor", () => ({
  ...realRuntimeWorkersModule,
  superviseWorker: superviseWorkerMock,
}));
mock.module("@files/server/paths", () => ({
  ...realFilePathsModule,
  resolveWorkspaceFile: (file: { path: string }) =>
    file.path === "other.csv"
      ? join(import.meta.dir, "../../../../package.json")
      : import.meta.path,
}));

const { spawnWorkerFromRequest, spawnWorker, buildWorkerPrompt, cancelWorkerFromRequest } =
  await import("./admission");
const { hasWorker, startWorkerRun } = await import("./registry");
const { subscribeWorkspaceEvents } = await import("@workspace/server/events");

afterAll(() => {
  mock.module("@workers/server/supervisor", () => realRuntimeWorkersModule);
  mock.module("@files/server/paths", () => realFilePathsModule);
});

beforeEach(() => {
  completions = [];
  superviseWorkerMock.mockClear();
  superviseWorkerMock.mockImplementation(supervise);
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
  test.each(["file", "app", "session", "inbox"] as const)(
    "%s spawning waits for durable admission, not execution",
    async (owner) => {
      const db = await openTestDatabase();
      const app = await new AppDatabase(db).create({
        definitionId: "regex",
        title: "Admission test",
        color: "#8b5cf6",
        state: {},
      });
      const admission =
        Promise.withResolvers<Awaited<ReturnType<typeof runtimeWorkersModule.superviseWorker>>>();
      superviseWorkerMock.mockImplementationOnce(() => admission.promise);
      const spawning =
        owner === "file"
          ? spawnWorkerFromRequest(input)
          : owner === "app"
            ? spawnWorkerFromRequest({ type: "app", appId: app.id, message: input.message })
            : owner === "session"
              ? spawnWorker({
                  owner: { type: "session", parentSessionId: "parent" },
                  retention: "durable",
                  message: input.message,
                })
              : spawnWorker({
                  owner: { type: "inbox" },
                  retention: "durable",
                  message: input.message,
                });
      let returned = false;
      void spawning.then(() => {
        returned = true;
      });
      await waitFor(() => expect(superviseWorkerMock).toHaveBeenCalledTimes(1));
      expect(returned).toBe(false);

      const sessionId = superviseWorkerMock.mock.calls[0]![0].worker.sessionId;
      admission.resolve({ sessionId, value: undefined });
      expect((await spawning).sessionId).toBe(sessionId);
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

    expect(hasWorker(sessionId)).toBe(true);
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

    await waitFor(() => expect(superviseWorkerMock).toHaveBeenCalledTimes(1));
    expect(superviseWorkerMock).toHaveBeenCalledWith({
      worker: {
        createdAt: expect.any(String),
        type: "file",
        sessionId,
        ephemeral: true,
        file,
        name: input.name,
        metadata: input.metadata,
      },
      message: { content: expect.stringContaining(input.message.content) },
      location: undefined,
      retention: "ephemeral",
    });
    expect(superviseWorkerMock.mock.calls[0]![0].message.content).toContain(import.meta.path);

    completion.resolve({ status: "completed" });
    await expect(eventWait).resolves.toEqual([{ status: "completed" }]);
    await waitFor(() => expect(hasWorker(sessionId)).toBe(false));
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

    await waitFor(() => expect(superviseWorkerMock).toHaveBeenCalledTimes(1));
    expect(superviseWorkerMock.mock.calls[0]![0]).toMatchObject({
      worker: {
        createdAt: expect.any(String),
        type: "app",
        sessionId: worker.sessionId,
        ephemeral: true,
        appId: app.id,
      },
      message: { model: { provider: "copilot", name: "gpt-5" } },
      location: { directory: "/repo", useWorktree: true },
    });
    const prompt = superviseWorkerMock.mock.calls[0]![0].message.content;
    expect(prompt).toContain(`app instance ID is "${app.id}"`);
    expect(prompt).toContain("tools are scoped to this owning app");
    expect(prompt).not.toContain('"testText": "1.2.3"');
    expect(prompt).not.toContain(`current revision is ${app.revision}`);
    expect(prompt).toContain("Generate a semantic-version expression.");

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(worker.sessionId)).toBe(false));
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

    await waitFor(() => expect(superviseWorkerMock).toHaveBeenCalledTimes(2));
    expect(
      superviseWorkerMock.mock.calls.map(([request]) => request.worker.sessionId).sort(),
    ).toEqual([firstWorker.sessionId, secondWorker.sessionId].sort());
    expect(
      superviseWorkerMock.mock.calls.find(
        ([request]) => request.worker.sessionId === secondWorker.sessionId,
      )?.[0].worker.ephemeral,
    ).toBe(false);

    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(secondWorker.sessionId)).toBe(false));
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
    superviseWorkerMock.mockImplementationOnce(async (input) => {
      await apps.delete(app.id);
      await input.admit?.();
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
    expect(superviseWorkerMock).not.toHaveBeenCalled();
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
    await waitFor(() => expect(superviseWorkerMock).toHaveBeenCalledTimes(2));

    await expect(
      cancelWorkerFromRequest({ type: "file", file, workerSessionId: firstWorker.sessionId }),
    ).resolves.toBe(true);
    expect(hasWorker(firstWorker.sessionId)).toBe(false);
    expect(hasWorker(secondWorker.sessionId)).toBe(true);

    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(hasWorker(secondWorker.sessionId)).toBe(false));
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
    expect(hasWorker(worker.sessionId)).toBe(true);

    completion.resolve({ status: "completed" });
  });

  test("rejects failed admission without interrupting an active sibling", async () => {
    const completion = Promise.withResolvers<SessionCompletion>();
    completions.push(completion.promise);
    const sibling = await spawnWorkerFromRequest(input);
    onTestFinished(() => completion.resolve({ status: "completed" }));
    expect(hasWorker(sibling.sessionId)).toBe(true);

    superviseWorkerMock.mockRejectedValueOnce(new Error("Unable to spawn."));
    await expect(
      spawnWorkerFromRequest({
        ...input,
        metadata: { placeholderId: "row-b" },
      }),
    ).rejects.toThrow("Unable to spawn.");
    expect(hasWorker(sibling.sessionId)).toBe(true);

    completion.resolve({ status: "completed", response: "Sibling result" });
    await expect(waitForSessions([sibling.sessionId])).resolves.toEqual([
      { status: "completed", response: "Sibling result" },
    ]);
    expect(hasWorker(sibling.sessionId)).toBe(false);
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
