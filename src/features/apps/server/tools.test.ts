import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, expect, mock, onTestFinished, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import * as databaseModule from "@/server/database";
import { AppDatabase } from "@apps/server/database";
import { resolveSessionArtifactPath } from "@files/server/paths";

const realDatabaseModule = { ...databaseModule };
let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  ...realDatabaseModule,
  getStateDatabase: async () => {
    if (!currentDb) throw new Error("Test database has not been opened.");
    return currentDb;
  },
}));

const { getSessionTools } = await import("@/server/sessionTools");

afterAll(() => {
  mock.module("@/server/database", () => realDatabaseModule);
});

test("app-owned state tools read and update only their owning app", async () => {
  currentDb = await databaseModule.createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
  const apps = new AppDatabase(currentDb);
  const owned = await apps.create({
    definitionId: "toybox-kanban",
    title: "Owned",
    color: "#f59e0b",
    state: { columns: [], cards: [] },
  });
  const unrelated = await apps.create({
    definitionId: "toybox-kanban",
    title: "Unrelated",
    color: "#f59e0b",
    state: { columns: [], cards: [] },
  });
  const invocation: ToolInvocation = {
    sessionId: "worker-a",
    toolCallId: "tool-a",
    toolName: "get_app",
    arguments: {},
  };
  const tools = getSessionTools("worker", owned.id);
  const getApp = tools.find(({ name }) => name === "get_app");
  const updateApp = tools.find(({ name }) => name === "update_app");

  const readResult = await getApp?.handler?.({}, invocation);
  expect(JSON.parse(String(readResult))).toMatchObject({
    ...owned,
    schema: { type: "object" },
  });

  await expect(
    updateApp?.handler?.(
      { expectedRevision: 0, state: [] },
      { ...invocation, toolCallId: "tool-invalid", toolName: "update_app" },
    ),
  ).rejects.toThrow("expected object");

  const updateResult = await updateApp?.handler?.(
    {
      expectedRevision: 0,
      state: {
        columns: [{ id: "todo", title: "Todo", tone: "neutral" }],
        cards: [],
      },
    },
    { ...invocation, toolCallId: "tool-b", toolName: "update_app" },
  );
  expect(JSON.parse(String(updateResult))).toMatchObject({
    status: "updated",
    app: {
      id: owned.id,
      state: {
        columns: [{ id: "todo", title: "Todo", tone: "neutral" }],
        cards: [],
      },
      revision: 1,
    },
  });
  expect(await apps.get(unrelated.id)).toMatchObject({
    state: { columns: [], cards: [] },
    revision: 0,
  });
});

test("artifact validation compiles the invoking session's current .toy file", async () => {
  const sessionId = `toy-box-artifact-tool-${crypto.randomUUID()}`;
  const artifactPath = resolveSessionArtifactPath(sessionId, "board.toy");
  if (!artifactPath) throw new Error("Expected a valid artifact path.");
  const sessionRoot = dirname(dirname(artifactPath));
  onTestFinished(() => rm(sessionRoot, { recursive: true, force: true }));
  await mkdir(dirname(artifactPath), { recursive: true });

  const tool = getSessionTools("standard").find(({ name }) => name === "validate_artifact_app");
  const invocation: ToolInvocation = {
    sessionId,
    toolCallId: "tool-artifact",
    toolName: "validate_artifact_app",
    arguments: { path: "board.toy" },
  };

  await Bun.write(artifactPath, "export default function Board() { return <main>Ready</main>; }");
  const valid = await tool?.handler?.({ path: "board.toy" }, invocation);
  expect(JSON.parse(String(valid))).toMatchObject({
    valid: true,
    path: "board.toy",
  });

  await Bun.write(artifactPath, "export default function Board() { return <MissingComponent />; }");
  const invalid = await tool?.handler?.({ path: "board.toy" }, invocation);
  expect(JSON.parse(String(invalid))).toMatchObject({
    valid: false,
    path: "board.toy",
    error: expect.stringMatching(/\.toybox-app\.tsx.*Cannot find name 'MissingComponent'/s),
  });
});
