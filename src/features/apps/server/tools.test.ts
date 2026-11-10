import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, onTestFinished, spyOn, test } from "bun:test";
import { openTestDatabase } from "@/server/testFixtures";
import { AppDatabase } from "@apps/server/database";
import { resolveSessionArtifactPath } from "@files/server/paths";
import { appDefinitionRegistry } from "./definitions";
import { artifactAppTools, createAppStateTools } from "./tools";

test("app-owned state tools read and update only their owning app", async () => {
  const definitionId = "test-board";
  const getDefinition = spyOn(appDefinitionRegistry, "get").mockResolvedValue({
    id: definitionId,
    title: "Board",
    color: "#f59e0b",
    accepts: [],
    opens: [],
    revision: "definition-a",
    state: { schema: { type: "object" }, default: {} },
    tsx: "export default function App() { return null; }",
  });
  onTestFinished(() => getDefinition.mockRestore());
  const apps = new AppDatabase(await openTestDatabase());
  const owned = await apps.create({
    definitionId,
    title: "Owned",
    color: "#f59e0b",
    state: { columns: [], cards: [] },
  });
  const unrelated = await apps.create({
    definitionId,
    title: "Unrelated",
    color: "#f59e0b",
    state: { columns: [], cards: [] },
  });
  const tools = createAppStateTools(owned.id);
  const getApp = tools.find(({ name }) => name === "get_app");
  const updateApp = tools.find(({ name }) => name === "update_app");

  const readResult = await getApp?.handler?.({}, "worker-a");
  expect(readResult).toMatchObject({
    ...owned,
    schema: { type: "object" },
    previewUrl: `/?apps=${encodeURIComponent(JSON.stringify([owned.id]))}`,
  });

  const updateResult = await updateApp?.handler?.(
    {
      expectedRevision: 0,
      state: {
        columns: [{ id: "todo", title: "Todo", tone: "neutral" }],
        cards: [],
      },
    },
    "worker-a",
  );
  expect(updateResult).toMatchObject({
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

test("listing saved app summaries is independent of definitions and pending shares", async () => {
  const definitions = spyOn(appDefinitionRegistry, "list").mockRejectedValue(
    new Error("Definitions are unavailable"),
  );
  const shares = spyOn(AppDatabase.prototype, "listShares").mockRejectedValue(
    new Error("Shares are unavailable"),
  );
  onTestFinished(() => {
    definitions.mockRestore();
    shares.mockRestore();
  });
  const { state: _state, ...summary } = await new AppDatabase(await openTestDatabase()).create({
    definitionId: "board",
    title: "Saved board",
    color: "#f59e0b",
    state: { privateDraft: "Omit from the listing" },
  });
  const tool = createAppStateTools().find(({ name }) => name === "list_apps");
  const result = await tool?.handler?.({}, "session-a");

  expect(result).toEqual([summary]);
});

test("artifact validation compiles the invoking session's current .toy file", async () => {
  const sessionId = `toy-box-artifact-tool-${crypto.randomUUID()}`;
  const artifactPath = resolveSessionArtifactPath(sessionId, "board.toy");
  if (!artifactPath) throw new Error("Expected a valid artifact path.");
  const sessionRoot = dirname(dirname(artifactPath));
  onTestFinished(() => rm(sessionRoot, { recursive: true, force: true }));
  await mkdir(dirname(artifactPath), { recursive: true });

  const tool = artifactAppTools.find(({ name }) => name === "validate_artifact_app");

  await Bun.write(artifactPath, "export default function Board() { return <main>Ready</main>; }");
  const valid = await tool?.handler?.({ path: "board.toy" }, sessionId);
  expect(valid).toMatchObject({
    valid: true,
    path: "board.toy",
    previewUrl: `/?files=${encodeURIComponent(
      JSON.stringify([{ kind: "session", sessionId, path: "board.toy" }]),
    )}`,
  });

  await Bun.write(artifactPath, "export default function Board() { return <MissingComponent />; }");
  const invalid = await tool?.handler?.({ path: "board.toy" }, sessionId);
  expect(invalid).toMatchObject({
    valid: false,
    path: "board.toy",
    error: expect.stringMatching(/\.toybox-app\.tsx.*Cannot find name 'MissingComponent'/s),
  });
});
