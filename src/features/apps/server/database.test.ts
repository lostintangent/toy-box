import { describe, expect, onTestFinished, setSystemTime, test } from "bun:test";
import { createTestDatabase } from "@/server/database";
import { SMALL_JSON_MAX_BYTES } from "@/shared/smallJson";
import { AppDatabase } from "./database";

async function openTestDatabase(): Promise<{
  apps: AppDatabase;
  db: Awaited<ReturnType<typeof createTestDatabase>>;
}> {
  const db = await createTestDatabase();
  onTestFinished(() => db.close());
  return { apps: new AppDatabase(db), db };
}

const initialApp: Parameters<AppDatabase["create"]>[0] = {
  definitionId: "kanban",
  title: "Launch board",
  color: "#f59e0b",
  state: {
    columns: [
      { id: "backlog", title: "Backlog" },
      { id: "doing", title: "In progress" },
    ],
    cards: [],
  },
};

describe("app instance database", () => {
  test("persists multiple independently stateful instances of one definition", async () => {
    setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
    onTestFinished(() => setSystemTime());
    const { apps } = await openTestDatabase();

    const launch = await apps.create(initialApp);
    const personal = await apps.create({
      ...initialApp,
      title: "Personal board",
      state: { columns: [{ id: "today", title: "Today" }], cards: [] },
    });

    expect(launch.id).toStartWith("toy-box-app-");
    expect(personal.id).not.toBe(launch.id);
    expect(await apps.list()).toEqual([launch, personal]);
  });

  test("lists instances alphabetically instead of by recent changes", async () => {
    const { apps } = await openTestDatabase();
    const zulu = await apps.create({ ...initialApp, title: "Zulu" });
    const alpha = await apps.create({ ...initialApp, title: "alpha" });

    await apps.update(zulu.id, { expectedRevision: zulu.revision, state: { recent: true } });

    expect((await apps.list()).map(({ id }) => id)).toEqual([alpha.id, zulu.id]);
  });

  test("round-trips app metadata and state", async () => {
    const { apps } = await openTestDatabase();
    const created = await apps.create(initialApp);

    const result = await apps.update(created.id, {
      expectedRevision: 0,
      title: "Release board",
      color: "#8b5cf6",
      state: {
        columns: [{ id: "queued", title: "Queued" }],
        cards: [{ id: "card-a", columnId: "queued", title: "Ship apps" }],
      },
    });

    expect(result).toMatchObject({
      status: "updated",
      app: {
        revision: 1,
        title: "Release board",
        color: "#8b5cf6",
        state: {
          columns: [{ id: "queued", title: "Queued" }],
          cards: [{ id: "card-a", columnId: "queued", title: "Ship apps" }],
        },
      },
    });
  });

  test("persists MIME-typed shares until their target consumes them", async () => {
    const { apps } = await openTestDatabase();
    const source = await apps.create(initialApp);
    const target = await apps.create({ ...initialApp, title: "Factory Floor" });
    const share = await apps.createShare({
      sourceAppId: source.id,
      targetAppId: target.id,
      mimeType: "text/markdown",
      content: "# Ship the release",
    });

    expect(await apps.listShares()).toEqual([share]);
    expect(await apps.deleteShare(source.id, share.id)).toBe(false);
    expect(await apps.deleteShare(target.id, share.id)).toBe(true);
    expect(await apps.listShares()).toEqual([]);

    await apps.createShare({
      sourceAppId: source.id,
      targetAppId: target.id,
      mimeType: "x-reference",
      content: "run-2",
    });
    await apps.delete(source.id);
    expect(await apps.listShares()).toEqual([]);
  });

  test("enforces the small-state bound at the durable boundary", async () => {
    const { apps } = await openTestDatabase();
    const oversizedState = { value: "x".repeat(SMALL_JSON_MAX_BYTES) };

    await expect(apps.create({ ...initialApp, state: oversizedState })).rejects.toThrow();

    const created = await apps.create(initialApp);
    await expect(
      apps.update(created.id, {
        expectedRevision: created.revision,
        state: oversizedState,
      }),
    ).rejects.toThrow();
    expect(await apps.get(created.id)).toEqual(created);
  });

  test("detects a stale writer without overwriting the current app", async () => {
    const { apps } = await openTestDatabase();
    const created = await apps.create(initialApp);
    const first = await apps.update(created.id, {
      expectedRevision: 0,
      state: { cards: [{ id: "card-a" }] },
    });
    const stale = await apps.update(created.id, {
      expectedRevision: 0,
      state: { cards: [{ id: "card-b" }] },
    });
    if (!first) throw new Error("Expected the app to exist");

    expect(first.status).toBe("updated");
    expect(stale).toEqual({ status: "conflict", app: first.app });
    expect((await apps.get(created.id))?.state).toEqual({ cards: [{ id: "card-a" }] });
  });

  test("deletes only the app row", async () => {
    const { apps, db } = await openTestDatabase();
    const created = await apps.create(initialApp);
    await db`
      INSERT INTO drafts (session_id, artifact_path, created_at)
      VALUES (${"ordinary-session"}, ${null}, ${1})
    `;

    expect(await apps.delete(created.id)).toBe(true);
    expect(await apps.get(created.id)).toBeNull();
    const drafts = await db<{ session_id: string }[]>`SELECT session_id FROM drafts`;
    expect(Array.from(drafts)).toEqual([{ session_id: "ordinary-session" }]);
  });

  test("checks definition use without loading instance state", async () => {
    const { apps } = await openTestDatabase();
    const created = await apps.create(initialApp);

    expect(await apps.hasInstancesForDefinition(initialApp.definitionId)).toBe(true);
    expect(await apps.hasInstancesForDefinition("unused")).toBe(false);
    await apps.delete(created.id);
    expect(await apps.hasInstancesForDefinition(initialApp.definitionId)).toBe(false);
  });
});
