import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { openTestDatabase } from "@/server/testFixtures";
import { deleteSavedDraft } from "./drafts";
import type { WorkspaceEvent } from "@workspace/model/events";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import { deleteSessionWorkspaceState, getWorkspaceState, updateDraft, updateSettings } from ".";

describe("workspace state", () => {
  test("persists settings as one complete document", async () => {
    const db = await openTestDatabase();
    expect((await getWorkspaceState()).settings).toEqual(DEFAULT_SETTINGS);

    const settings = await updateSettings({ accentColor: "#123abc", pinnedSessionIds: ["a"] });

    const rows = await db<{ id: number; value: string }[]>`SELECT id, value FROM settings`;
    expect(Array.from(rows)).toEqual([{ id: 1, value: JSON.stringify(settings) }]);
  });

  test("merges precise settings updates before broadcasting their complete value", async () => {
    await openTestDatabase();
    const initial = {
      ...(await getWorkspaceState()).settings,
      defaultModel: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
      terminalShell: "/bin/zsh",
      pinnedSessionIds: ["session-a"],
    };
    await updateSettings(initial);

    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === "settings.changed") events.push(event);
    });
    onTestFinished(unsubscribe);
    const settings = {
      ...initial,
      accentColor: "#123abc" as const,
    };

    expect(await updateSettings({ accentColor: settings.accentColor })).toEqual(settings);
    expect(await updateSettings({ accentColor: settings.accentColor })).toEqual(settings);

    expect((await getWorkspaceState()).settings).toEqual(settings);
    expect(events).toEqual([{ type: "settings.changed", settings }]);
  });

  test("serializes concurrent settings updates, so none is lost", async () => {
    await openTestDatabase();

    await Promise.all([
      updateSettings({ accentColor: "#123abc" }),
      updateSettings({ terminalShell: "/bin/fish" }),
      updateSettings({ serverName: "Studio" }),
    ]);

    expect((await getWorkspaceState()).settings).toMatchObject({
      accentColor: "#123abc",
      terminalShell: "/bin/fish",
      serverName: "Studio",
    });
  });

  test("deleting a session drops only its own pin and Hyper membership", async () => {
    await openTestDatabase();
    await updateSettings({ pinnedSessionIds: ["kept", "deleted"], hyperSessionId: "hyper" });

    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === "settings.changed") events.push(event);
    });
    onTestFinished(unsubscribe);

    await deleteSessionWorkspaceState("deleted");
    expect((await getWorkspaceState()).settings).toMatchObject({
      pinnedSessionIds: ["kept"],
      hyperSessionId: "hyper",
    });

    await deleteSessionWorkspaceState("hyper");
    expect((await getWorkspaceState()).settings).toMatchObject({
      pinnedSessionIds: ["kept"],
      hyperSessionId: null,
    });

    // Deleting a session that was neither pinned nor Hyper commits and broadcasts nothing.
    await deleteSessionWorkspaceState("unrelated");
    expect(events).toHaveLength(2);
  });

  test("snapshot exposes a session's draft", async () => {
    await openTestDatabase();
    const sessionId = `workspace-snapshot-${crypto.randomUUID()}`;
    onTestFinished(() => deleteSavedDraft(`session:${sessionId}`));

    updateDraft(`session:${sessionId}`, "hello", "client-a");

    const state = await getWorkspaceState();
    expect(state.drafts[`session:${sessionId}`]).toMatchObject({
      text: "hello",
      origin: "client-a",
    });
  });
});
