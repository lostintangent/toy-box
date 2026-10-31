import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { createTestDatabase } from "@/server/database";
import { addHyperSession, deleteHyperState } from "./hyperSessions";
import { deleteSavedDraft } from "./drafts";
import type { WorkspaceEvent } from "@workspace/model/events";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { applyWorkspaceAction, getWorkspaceState, unpinSession, updateSettings } = await import(".");

async function openWorkspaceTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}

function cleanup(sessionId: string): void {
  deleteSavedDraft(`session:${sessionId}`);
  deleteHyperState(sessionId);
}

describe("workspace state", () => {
  test("persists settings as one complete document", async () => {
    await openWorkspaceTestDatabase();
    expect((await getWorkspaceState()).settings).toEqual(DEFAULT_SETTINGS);

    const settings = await updateSettings({ accentColor: "#123abc", pinnedSessionIds: ["a"] });

    const rows = await currentDb!<{ id: number; value: string }[]>`SELECT id, value FROM settings`;
    expect(Array.from(rows)).toEqual([{ id: 1, value: JSON.stringify(settings) }]);
  });

  test("merges precise settings updates before broadcasting their complete value", async () => {
    await openWorkspaceTestDatabase();
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

  test("serializes concurrent settings updates", async () => {
    await openWorkspaceTestDatabase();

    await Promise.all([
      updateSettings({ accentColor: "#123abc" }),
      updateSettings({ terminalShell: "/bin/fish" }),
    ]);

    expect((await getWorkspaceState()).settings).toMatchObject({
      accentColor: "#123abc",
      terminalShell: "/bin/fish",
    });
  });

  test("deleting a session drops only its own pin", async () => {
    await openWorkspaceTestDatabase();
    await updateSettings({ pinnedSessionIds: ["kept", "deleted"] });

    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type === "settings.changed") events.push(event);
    });
    onTestFinished(unsubscribe);

    await unpinSession("deleted");
    expect((await getWorkspaceState()).settings.pinnedSessionIds).toEqual(["kept"]);

    // Deleting a session that was never pinned commits and broadcasts nothing.
    await unpinSession("never-pinned");
    expect(events).toHaveLength(1);
  });

  test("snapshot exposes a session's draft and Hyper membership", async () => {
    const sessionId = `workspace-snapshot-${crypto.randomUUID()}`;
    onTestFinished(() => cleanup(sessionId));

    addHyperSession(sessionId);
    applyWorkspaceAction({
      type: "draft.changed",
      key: `session:${sessionId}`,
      draft: { text: "hello", origin: "client-a", updatedAt: 0 },
    });

    const state = await getWorkspaceState();
    expect(state.drafts[`session:${sessionId}`]).toMatchObject({
      text: "hello",
      origin: "client-a",
    });
    expect(state.hyperSessionIds).toContain(sessionId);
  });
});
