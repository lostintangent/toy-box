import { expect, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "../database";
import { DEFAULT_SETTINGS } from "@/lib/workspace/config/settings";
import { SettingsDatabase } from "./settings";

test("persists one complete settings document", async () => {
  const database = await createTestDatabase();
  onTestFinished(() => database.close());
  const settingsDatabase = new SettingsDatabase(database);
  const settings = {
    ...DEFAULT_SETTINGS,
    accentColor: "#123abc" as const,
    defaultModel: { name: "gpt-5", reasoningEffort: "high" },
    terminalShell: "/bin/zsh",
    useWorktree: true,
    pinnedSessionIds: ["session-a"],
  };

  expect(await settingsDatabase.get()).toEqual(DEFAULT_SETTINGS);
  expect(await settingsDatabase.set(settings)).toBe(true);
  expect(
    await settingsDatabase.set({
      ...settings,
      defaultModel: { ...settings.defaultModel },
      pinnedSessionIds: [...settings.pinnedSessionIds],
    }),
  ).toBe(false);
  expect(await settingsDatabase.get()).toEqual(settings);

  const rows = await database<{ id: number; value: string }[]>`SELECT id, value FROM settings`;
  expect(Array.from(rows)).toEqual([{ id: 1, value: JSON.stringify(settings) }]);
});
