import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  onTestFinished,
  spyOn,
  test,
} from "bun:test";
import * as databaseModule from "@/functions/state/database";
import * as runtimeWorkersModule from "@/functions/workers/supervisor";
import * as sessionRegistryModule from "@/functions/state/session/registry";
import * as definitionsModule from "../state/definitions";
import * as gistModule from "./gist";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import type { AppDefinition } from "@/types";
import { AppDatabase } from "../state/database";

const realDatabaseModule = { ...databaseModule };
const realRuntimeWorkersModule = { ...runtimeWorkersModule };
const realSessionRegistryModule = { ...sessionRegistryModule };
const realDefinitionsModule = { ...definitionsModule };
const realGistModule = { ...gistModule };

let currentDb: Bun.SQL | undefined;
const objectState = { schema: { type: "object" as const }, default: {} };
const arrayState = {
  schema: { type: "array" as const, items: { type: "string" as const } },
  default: [],
};
const gistManifest = JSON.stringify({ title: "Café Board", state: arrayState });
const cancelWorkerMock = mock(async (_sessionId: string) => false);
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);
const getDefinitionMock = mock(
  async (definitionId: string): Promise<AppDefinition & { tsx: string }> => ({
    id: definitionId,
    title: "Shared board",
    color: "#3b82f6" as const,
    accepts: [],
    revision: "definition-a",
    state: objectState,
    tsx: "export default function App() { return null; }",
  }),
);
const installDefinitionMock = mock(
  async (
    definitionId: string,
    _candidate: ReturnType<typeof definitionsModule.parseAppDefinitionFiles>,
  ) => ({
    id: definitionId,
    title: "Café Board",
    color: "#71717a" as const,
    state: arrayState,
    accepts: [],
    revision: "definition-a",
  }),
);
const uninstallDefinitionMock = mock(async (_definitionId: string) => true);
const downloadGistAppMock = mock(async (_url: string) => ({
  gistId: "aa5a315d61ae9438b18d",
  manifest: gistManifest,
  tsx: "export default function App() { return <main />; }",
}));

mock.module("@/functions/state/database", () => ({
  ...realDatabaseModule,
  getStateDatabase: async () => {
    if (!currentDb) throw new Error("Test database has not been opened.");
    return currentDb;
  },
}));
mock.module("@/functions/workers/supervisor", () => ({
  ...realRuntimeWorkersModule,
  cancelWorker: cancelWorkerMock,
}));
mock.module("@/functions/state/session/registry", () => ({
  ...realSessionRegistryModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));
mock.module("../state/definitions", () => ({
  ...realDefinitionsModule,
  appDefinitionRegistry: {
    get: getDefinitionMock,
    install: installDefinitionMock,
    uninstall: uninstallDefinitionMock,
  },
}));
mock.module("./gist", () => ({
  downloadGistApp: downloadGistAppMock,
}));

const { consumeAppShare, createApp, deleteApp, installApp, shareWithApp, uninstallApp, updateApp } =
  await import("./index");
const { finishWorker, hasWorker, startWorker } = await import("@/functions/state/workspace");
const { registerWorkerSession } = await import("@/functions/state/session/workers");

afterAll(() => {
  mock.module("@/functions/state/database", () => realDatabaseModule);
  mock.module("@/functions/workers/supervisor", () => realRuntimeWorkersModule);
  mock.module("@/functions/state/session/registry", () => realSessionRegistryModule);
  mock.module("../state/definitions", () => realDefinitionsModule);
  mock.module("./gist", () => realGistModule);
});

beforeEach(() => {
  currentDb = undefined;
  cancelWorkerMock.mockClear();
  cancelWorkerMock.mockImplementation(async () => false);
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => true);
  getDefinitionMock.mockClear();
  installDefinitionMock.mockClear();
  uninstallDefinitionMock.mockClear();
  uninstallDefinitionMock.mockImplementation(async () => true);
  downloadGistAppMock.mockClear();
});

describe("app lifecycle", () => {
  test("rejects invalid state before creating an instance", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());

    await expect(createApp({ definitionId: "shared-board", state: [] })).rejects.toThrow();

    expect(await new AppDatabase(db).list()).toEqual([]);
  });

  test("rejects invalid state before updating an instance", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const app = await createApp({ definitionId: "shared-board" });

    await expect(
      updateApp({ appId: app.id, expectedRevision: app.revision, state: [] }),
    ).rejects.toThrow();

    expect(await new AppDatabase(db).get(app.id)).toMatchObject({ state: {}, revision: 0 });
  });

  test("shares only with app definitions that accept the MIME type", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const apps = new AppDatabase(db);
    const source = await apps.create({
      definitionId: "kanban",
      title: "Kanban",
      color: "#f59e0b",
      state: {},
    });
    const target = await apps.create({
      definitionId: "factory-floor",
      title: "Factory Floor",
      color: "#f97316",
      state: {},
    });
    getDefinitionMock.mockImplementation(async (definitionId) => ({
      id: definitionId,
      title: definitionId === "factory-floor" ? "Factory Floor" : "Kanban",
      color: "#f97316" as const,
      accepts: definitionId === "factory-floor" ? ["text/markdown"] : [],
      revision: "definition-a",
      state: objectState,
      tsx: "export default function App() { return null; }",
    }));
    const events: string[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => events.push(event.type));
    onTestFinished(unsubscribe);

    const share = await shareWithApp({
      appId: source.id,
      targetAppId: target.id,
      mimeType: "text/markdown",
      content: "# Ship it",
    });

    expect(await apps.listShares()).toEqual([share]);
    expect(events).toEqual(["app.share.created"]);
    expect(await consumeAppShare({ appId: source.id, shareId: share.id })).toBe(false);
    expect(await apps.listShares()).toEqual([share]);
    expect(await consumeAppShare({ appId: target.id, shareId: share.id })).toBe(true);
    expect(await consumeAppShare({ appId: target.id, shareId: share.id })).toBe(false);
    expect(await apps.listShares()).toEqual([]);
    expect(events).toEqual(["app.share.created", "app.share.deleted"]);

    await expect(
      shareWithApp({
        appId: target.id,
        targetAppId: source.id,
        mimeType: "text/plain",
        content: "Rejected",
      }),
    ).rejects.toThrow("does not accept text/plain content");
  });

  test("deletion cancels live app workers and removes queued or abandoned workers", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const app = await new AppDatabase(db).create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: {},
    });
    const active = "active-app-worker";
    const queued = "queued-app-worker";
    const abandoned = "abandoned-app-worker";
    for (const sessionId of [active, queued]) {
      startWorker({ type: "app", sessionId, appId: app.id, ephemeral: true });
      onTestFinished(() => finishWorker(sessionId));
    }
    await registerWorkerSession({
      type: "app",
      sessionId: active,
      appId: app.id,
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "app",
      sessionId: abandoned,
      appId: app.id,
      ephemeral: true,
    });
    cancelWorkerMock.mockImplementation(async (sessionId) => sessionId === active);

    await expect(deleteApp(app.id)).resolves.toBeUndefined();

    expect(await new AppDatabase(db).get(app.id)).toBeNull();
    expect(hasWorker(active)).toBe(false);
    expect(hasWorker(queued)).toBe(false);
    expect(cancelWorkerMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      abandoned,
      active,
      queued,
    ]);
    expect(deleteSessionIfExistsMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      abandoned,
      active,
      queued,
    ]);
  });

  test("deletion attempts every worker cleanup after the app is gone", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const app = await new AppDatabase(db).create({
      definitionId: "regex",
      title: "Regex",
      color: "#8b5cf6",
      state: {},
    });
    await registerWorkerSession({
      type: "app",
      sessionId: "failed-cleanup",
      appId: app.id,
      ephemeral: false,
    });
    await registerWorkerSession({
      type: "app",
      sessionId: "successful-cleanup",
      appId: app.id,
      ephemeral: true,
    });
    cancelWorkerMock.mockImplementation(async (sessionId) => {
      if (sessionId === "failed-cleanup") throw new Error("cancel failed");
      return false;
    });
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await expect(deleteApp(app.id)).resolves.toBeUndefined();

    expect(await new AppDatabase(db).get(app.id)).toBeNull();
    expect(cancelWorkerMock).toHaveBeenCalledTimes(2);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith("successful-cleanup");
    expect(log).toHaveBeenCalledWith(
      "Unable to clean up an app worker:",
      expect.objectContaining({ message: "cancel failed" }),
    );
  });

  test("uninstall refuses to orphan saved instances before removing the definition", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const apps = new AppDatabase(db);
    const app = await apps.create({
      definitionId: "shared-board",
      title: "Shared board",
      color: "#3b82f6",
      state: {},
    });

    await expect(uninstallApp({ id: "shared-board" })).rejects.toThrow(
      "still used by saved app instances",
    );
    expect(uninstallDefinitionMock).not.toHaveBeenCalled();

    await apps.delete(app.id);
    const events: string[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => events.push(event.type));
    onTestFinished(unsubscribe);

    await expect(uninstallApp({ id: "shared-board" })).resolves.toBeUndefined();
    expect(uninstallDefinitionMock).toHaveBeenCalledWith("shared-board");
    expect(events).toContain("app.unregistered");
  });

  test("serializes instance creation with definition removal", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const entered = deferred<void>();
    const release = deferred<void>();
    getDefinitionMock.mockImplementationOnce(async (definitionId) => {
      entered.resolve();
      await release.promise;
      return {
        id: definitionId,
        title: "Shared board",
        color: "#3b82f6",
        accepts: [],
        revision: "definition-a",
        state: objectState,
        tsx: "export default function App() { return null; }",
      };
    });

    const creation = createApp({ definitionId: "shared-board" });
    await entered.promise;
    const uninstall = uninstallApp({ id: "shared-board" });
    const uninstallResult = uninstall.then(
      () => null,
      (error: unknown) => error,
    );
    expect(uninstallDefinitionMock).not.toHaveBeenCalled();

    release.resolve();
    await expect(creation).resolves.toMatchObject({ definitionId: "shared-board" });
    expect(await uninstallResult).toEqual(
      new Error(
        'App definition "shared-board" is still used by saved app instances. Delete them before uninstalling the definition.',
      ),
    );
    expect(uninstallDefinitionMock).not.toHaveBeenCalled();
  });

  test("Gist installation registers a definition and creates its first instance", async () => {
    currentDb = await databaseModule.createTestDatabase();
    const db = currentDb;
    onTestFinished(async () => db.close());
    const events: string[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => events.push(event.type));
    onTestFinished(unsubscribe);

    await expect(
      installApp({ url: "https://gist.github.com/octocat/aa5a315d61ae9438b18d" }),
    ).resolves.toMatchObject({
      definition: {
        id: "cafe-board",
        revision: "definition-a",
      },
      app: {
        definitionId: "cafe-board",
        title: "Café Board",
        color: "#71717a",
        state: [],
      },
    });
    expect(installDefinitionMock).toHaveBeenCalledWith(
      "cafe-board",
      definitionsModule.parseAppDefinitionFiles({
        manifest: gistManifest,
        tsx: "export default function App() { return <main />; }",
      }),
    );
    expect(await new AppDatabase(db).list()).toEqual([
      expect.objectContaining({
        definitionId: "cafe-board",
        title: "Café Board",
        color: "#71717a",
        state: [],
      }),
    ]);
    expect(events).toEqual(["app.registered", "app.upserted"]);
  });

  test("Gist installation removes the definition when its first instance cannot be saved", async () => {
    const events: string[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => events.push(event.type));
    onTestFinished(unsubscribe);

    await expect(
      installApp({ url: "https://gist.github.com/octocat/aa5a315d61ae9438b18d" }),
    ).rejects.toThrow("Test database has not been opened");

    expect(uninstallDefinitionMock).toHaveBeenCalledWith("cafe-board");
    expect(events).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
