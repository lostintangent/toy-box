import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, setSystemTime, spyOn, test } from "bun:test";
import { createTestDatabase } from "@/server/database";
import type { AutomationOptions } from "../model";
import { AutomationDatabase } from "./database";

const options = {
  title: "Daily summary",
  prompt: "Summarize open pull requests.",
  model: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
  cron: "0 9 * * *",
  cwd: "/repo/automation",
} satisfies AutomationOptions;

describe("automation persistence and scheduling", () => {
  test("saved edits and their schedule survive reopening the database", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const directory = await mkdtemp(join(tmpdir(), "toy-box-automations-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "automations.sqlite");
    const first = await openTestDatabase(path);
    const created = await first.automations.create(options);
    const edited = {
      ...options,
      title: "Afternoon summary",
      prompt: "Summarize repository status.",
      model: { provider: "codex", name: "gpt-5.5", reasoningEffort: "medium" },
      cron: "0 12 * * *",
      cwd: "/repo/updated",
    } satisfies AutomationOptions;
    const updated = (await first.automations.update(created.id, edited))!;
    await first.db.close();

    const reopened = await openTestDatabase(path);
    const saved = await reopened.automations.get(created.id);
    expect(saved).toMatchObject({ ...edited, id: created.id });
    expect(saved?.nextRunAt).not.toBe(created.nextRunAt);
    expect(await reopened.automations.list()).toEqual([updated]);
  });

  test("claims each due automation once and skips missed occurrences", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const { automations } = await openTestDatabase();
    const created = await automations.create({ ...options, cron: "* * * * *" });

    setSystemTime(new Date("2026-02-14T10:00:30.000Z"));
    expect(await automations.claimDue()).toEqual([]);

    setSystemTime(new Date("2026-02-14T10:05:30.000Z"));
    expect(await automations.claimDue()).toEqual([
      { ...created, nextRunAt: "2026-02-14T10:06:00.000Z" },
    ]);
    expect(await automations.claimDue()).toEqual([]);
    expect((await automations.get(created.id))?.nextRunAt).toBe("2026-02-14T10:06:00.000Z");
  });

  test("records completion without changing the definition or its next occurrence", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const { automations } = await openTestDatabase();
    const created = await automations.create({ ...options, cwd: undefined });
    const finishedAt = new Date("2026-02-14T10:05:00.000Z");

    const finished = await automations.recordRunFinish(created.id, finishedAt);

    expect(finished).toEqual({
      ...created,
      lastRunAt: finishedAt.toISOString(),
      updatedAt: finishedAt.toISOString(),
    });
    expect(await automations.get(created.id)).toEqual(finished);
    expect(await automations.recordRunFinish("missing", finishedAt)).toBeNull();
  });

  test("an unreadable definition does not hide or block healthy automations", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const { db, automations } = await openTestDatabase();
    const valid = await automations.create({ ...options, cron: "* * * * *" });
    const invalid = await automations.create({
      ...options,
      title: "Unreadable",
      cron: "* * * * *",
    });
    await db`UPDATE automations SET model_configuration = ${"{bad json"} WHERE id = ${invalid.id}`;

    expect(await automations.list()).toEqual([valid]);
    setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    expect(await automations.claimDue()).toEqual([
      { ...valid, nextRunAt: "2026-02-14T10:02:00.000Z" },
    ]);
    const [row] = await db<{ next_run_at: string }[]>`
      SELECT next_run_at FROM automations WHERE id = ${invalid.id}
    `;
    expect(row?.next_run_at).toBe("2026-02-14T10:02:00.000Z");
  });
});

function mockTime(date: string): void {
  setSystemTime(new Date(date));
  onTestFinished(() => setSystemTime());
}

async function openTestDatabase(path = ":memory:") {
  const db = await createTestDatabase(path);
  onTestFinished(() => db.close());
  return { db, automations: new AutomationDatabase(db) };
}
