import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, setSystemTime, test } from "bun:test";
import { AutomationDatabase } from "./database";

function mockTime(date: string | Date): void {
  setSystemTime(new Date(date));
  onTestFinished(() => setSystemTime());
}

async function openTestDatabase(path = ":memory:"): Promise<AutomationDatabase> {
  const db = await AutomationDatabase.open(path);
  onTestFinished(() => db.close());
  return db;
}

describe("automation database", () => {
  test("persists automations across reopens with file-backed sqlite", async () => {
    mockTime("2026-02-14T10:00:00.000Z");

    const tempDirectory = await mkdtemp(join(tmpdir(), "toy-box-automations-"));
    onTestFinished(async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    });

    const databasePath = join(tempDirectory, "automations.sqlite");

    const db1 = await AutomationDatabase.open(databasePath);
    const created = await db1.create({
      title: "Daily summary",
      prompt: "Summarize open pull requests.",
      model: "gpt-5",
      cron: "0 9 * * *",
      reuseSession: true,
      cwd: "/Users/test/project",
    });

    const initialList = await db1.list();
    expect(initialList.map((a) => a.id)).toContain(created.id);
    db1.close();

    const db2 = await AutomationDatabase.open(databasePath);
    onTestFinished(() => db2.close());

    const reloadedList = await db2.list();
    const reloaded = reloadedList.find((a) => a.id === created.id);
    expect(reloaded?.title).toBe("Daily summary");
    expect(reloaded?.prompt).toBe("Summarize open pull requests.");
    expect(reloaded?.model).toBe("gpt-5");
    expect(reloaded?.cron).toBe("0 9 * * *");
    expect(reloaded?.reuseSession).toBe(true);
    expect(reloaded?.cwd).toBe("/Users/test/project");
  });

  test("claims due automations and reschedules their next run", async () => {
    mockTime("2026-02-14T10:00:00.000Z");
    const db = await openTestDatabase();

    const created = await db.create({
      title: "Minute ping",
      prompt: "Ping",
      model: "gpt-5",
      cron: "* * * * *",
      reuseSession: false,
    });
    expect(created.reuseSession).toBe(false);
    expect(created.cwd).toBeUndefined();

    setSystemTime(new Date("2026-02-14T10:00:30.000Z"));
    const beforeDue = await db.claimDue();
    expect(beforeDue).toHaveLength(0);

    setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    const due = await db.claimDue();
    expect(due.map((a) => a.id)).toEqual([created.id]);

    const updated = await db.getById(created.id);
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
      model: "gpt-5",
      cron: "0 9 * * *",
      reuseSession: false,
    });

    setSystemTime(new Date("2026-02-14T10:05:00.000Z"));
    const updated = await db.update(created.id, {
      title: "Updated title",
      prompt: "Updated prompt",
      cron: "0 12 * * *",
      model: "gpt-5",
      reuseSession: false,
      cwd: "/tmp/updated",
    });
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Updated title");
    expect(updated?.prompt).toBe("Updated prompt");
    expect(updated?.cron).toBe("0 12 * * *");
    expect(updated?.cwd).toBe("/tmp/updated");
  });
});
