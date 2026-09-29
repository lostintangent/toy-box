import { expect, test } from "bun:test";
import { createEmptyWorkspaceState } from "@workspace/model/state/reducer";
import type { InboxEntry } from "./model";
import { isInboxTaskRunning, selectInboxSessions, sortInboxEntries } from "./queries";
import { createEmptySessionsState } from "@sessions/queries";

const older = {
  id: "older",
  createdAt: "2026-01-01T00:00:00.000Z",
  kind: "pending",
} satisfies InboxEntry;
const newer = {
  id: "newer",
  createdAt: "2026-01-02T00:00:00.000Z",
  kind: "pending",
} satisfies InboxEntry;

test("Inbox entries order running work before recency", () => {
  expect(sortInboxEntries([older, newer], createEmptyWorkspaceState())).toEqual([newer, older]);
  const workspace = {
    ...createEmptyWorkspaceState(),
    sessionStates: { older: { status: "running" as const, since: 1 } },
  };

  expect(sortInboxEntries([newer, older], workspace).map(({ id }) => id)).toEqual([
    "older",
    "newer",
  ]);
});

test("admitted Workers keep entries active before a Session starts, even after publication", () => {
  const workspace = {
    ...createEmptyWorkspaceState(),
    workers: [
      {
        type: "inbox" as const,
        sessionId: older.id,
        createdAt: older.createdAt,
        ephemeral: false as const,
      },
    ],
  };
  expect(isInboxTaskRunning(workspace, older.id)).toBe(true);
  const published = { ...older, kind: "result", message: "Already reported" } satisfies InboxEntry;
  expect(sortInboxEntries([newer, published], workspace)).toEqual([published, newer]);
  expect(isInboxTaskRunning({ ...workspace, workers: [] }, older.id)).toBe(false);
});

test("Inbox session choices include ordinary and Inbox sessions but exclude other Workers", () => {
  const sessions = ["ordinary", "inbox-worker", "file-worker"].map((id) => ({
    id,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));
  const selected = selectInboxSessions(
    {
      ...createEmptySessionsState(),
      sessions,
      ownership: {
        "inbox-worker": { type: "worker", parentSessionId: null },
        "file-worker": { type: "worker", parentSessionId: "ordinary" },
      },
    },
    [{ id: "inbox-worker", createdAt: new Date(0).toISOString(), kind: "pending" }],
  );
  expect(selected.map(({ id }) => id)).toEqual(["ordinary", "inbox-worker"]);
});
