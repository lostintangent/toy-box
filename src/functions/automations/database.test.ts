import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, setSystemTime, spyOn, test } from "bun:test";
import { createTestDatabase } from "../state/database";
import { AutomationDatabase } from "./database";

function mockTime(date: string | Date): void {
  setSystemTime(new Date(date));
  onTestFinished(() => setSystemTime());
}

async function openTestDatabase(path = ":memory:"): Promise<AutomationDatabase> {
  const db = await createTestDatabase(path);
  return new AutomationDatabase(db);
}

describe("automation database", () => {
  test("persists automations across reopens with file-backed sqlite", async () => {
    mockTime("2026-02-14T10:00:00.000Z");

    const tempDirectory = await mkdtemp(join(tmpdir(), "toy-box-automations-"));
    onTestFinished(async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    });

    const databasePath = join(tempDirectory, "automations.sqlite");

    const db1 = await openTestDatabase(databasePath);
    const created = await db1.create({
      title: "Daily summary",
      prompt: "Summarize open pull requests.",
      model: { name: "gpt-5", reasoningEffort: "high" },
      cron: "0 9 * * *",
      cwd: "/Users/test/project",
    });

    const initialList = await db1.list();
    expect(initialList.map((a) => a.id)).toContain(created.id);

    const db2 = await openTestDatabase(databasePath);

    const reloadedList = await db2.list();
    const reloaded = reloadedList.find((a) => a.id === created.id);
    expect(reloaded?.title).toBe("Daily summary");
    expect(reloaded?.prompt).toBe("Summarize open pull requests.");
    expect(reloaded?.model).toEqual({ name: "gpt-5", reasoningEffort: "high" });
    expect(reloaded?.cron).toBe("0 9 * * *");
    expect(reloaded?.id).toBe(created.id);
    expect(reloaded?.id).toStartWith("toy-box-auto-");
    expect(reloaded?.cwd).toBe("/Users/test/project");
  });

  test("claims due automations and reschedules their next run", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const db = await openTestDatabase();

    const created = await db.create({
      title: "Minute ping",
      prompt: "Ping",
      model: { name: "gpt-5" },
      cron: "* * * * *",
    });
    expect(created.cwd).toBeUndefined();

    setSystemTime(new Date("2026-02-14T10:00:30.000Z"));
    const beforeDue = await db.claimDue();
    expect(beforeDue).toHaveLength(0);

    setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    const due = await db.claimDue();
    expect(due.map((a) => a.id)).toEqual([created.id]);
    expect(new Date(due[0]!.nextRunAt).getTime()).toBeGreaterThan(
      new Date("2026-02-14T10:01:30.000Z").getTime(),
    );
    expect(await db.claimDue()).toEqual([]);

    const updated = await db.get(created.id);
    expect(updated).not.toBeNull();
    expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(
      new Date("2026-02-14T10:01:30.000Z").getTime(),
    );
  });

  test("updates title and prompt for an existing automation", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const db = await openTestDatabase();

    const created = await db.create({
      title: "Original title",
      prompt: "Original prompt",
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
    });

    setSystemTime(new Date("2026-02-14T10:05:00.000Z"));
    const updated = await db.update(created.id, {
      title: "Updated title",
      prompt: "Updated prompt",
      cron: "0 12 * * *",
      model: { name: "gpt-5", reasoningEffort: "medium" },
      cwd: "/tmp/updated",
    });
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Updated title");
    expect(updated?.prompt).toBe("Updated prompt");
    expect(updated?.cron).toBe("0 12 * * *");
    expect(updated?.model).toEqual({ name: "gpt-5", reasoningEffort: "medium" });
    expect(updated?.cwd).toBe("/tmp/updated");
    expect(updated?.nextRunAt).not.toBe(created.nextRunAt);
  });

  test("deletes an existing automation once", async () => {
    const db = await openTestDatabase();
    const created = await db.create({
      title: "Temporary",
      prompt: "Run once.",
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
    });

    expect(await db.delete(created.id)).toBe(true);
    expect(await db.get(created.id)).toBeNull();
    expect(await db.delete(created.id)).toBe(false);
  });

  test("records completion metadata without changing automation identity", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const db = await openTestDatabase();
    const created = await db.create({
      title: "Daily summary",
      prompt: "Summarize status.",
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
    });

    const finishedAt = new Date("2026-02-14T10:05:00.000Z");
    await db.recordRunFinish(created.id, finishedAt);
    expect(await db.get(created.id)).toMatchObject({
      id: created.id,
      lastRunAt: finishedAt.toISOString(),
      updatedAt: finishedAt.toISOString(),
    });
  });

  test("skips malformed automation rows when listing", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => consoleErrorMock.mockRestore());
    const rawDb = await createTestDatabase();
    const db = new AutomationDatabase(rawDb);

    const valid = await db.create({
      title: "Valid automation",
      prompt: "Summarize status.",
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
    });
    await rawDb.sql`
      INSERT INTO automations (id, title, prompt, model_configuration, cron, cwd, created_at, updated_at, next_run_at)
      VALUES (${"broken"}, ${"Broken automation"}, ${"noop"}, ${"{bad json"}, ${"0 9 * * *"}, ${null}, ${"2026-02-14T10:00:00.000Z"}, ${"2026-02-14T10:00:00.000Z"}, ${"2026-02-14T10:00:00.000Z"})
    `;

    expect((await db.list()).map((automation) => automation.id)).toEqual([valid.id]);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
  });

  test("skips malformed due rows without dropping valid claims", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => consoleErrorMock.mockRestore());
    const rawDb = await createTestDatabase();
    const db = new AutomationDatabase(rawDb);

    const valid = await db.create({
      title: "Valid due automation",
      prompt: "Summarize status.",
      model: { name: "gpt-5" },
      cron: "* * * * *",
    });
    await rawDb.sql`
      INSERT INTO automations (id, title, prompt, model_configuration, cron, cwd, created_at, updated_at, next_run_at)
      VALUES (${"broken-due"}, ${"Broken due automation"}, ${"noop"}, ${"{bad json"}, ${"* * * * *"}, ${null}, ${"2026-02-14T10:00:00.000Z"}, ${"2026-02-14T10:00:00.000Z"}, ${"2026-02-14T10:00:00.000Z"})
    `;

    setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    expect((await db.claimDue()).map((automation) => automation.id)).toEqual([valid.id]);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);

    const rows = await rawDb.sql`SELECT id, next_run_at FROM automations ORDER BY id`;
    expect(rows.rows).toContainEqual({
      id: "broken-due",
      next_run_at: expect.stringMatching(/^2026-02-14T10:02:/),
    });
    expect(rows.rows).toContainEqual({
      id: valid.id,
      next_run_at: expect.stringMatching(/^2026-02-14T10:02:/),
    });
  });
});
