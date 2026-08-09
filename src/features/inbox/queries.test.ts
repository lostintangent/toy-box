import { expect, test } from "bun:test";
import { createEmptyWorkspaceState } from "@workspace/model/state/reducer";
import type { InboxEntry } from "./model";
import { inboxQueries } from "./queries";

const older = { id: "older", createdAt: "2026-01-01T00:00:00.000Z" } satisfies InboxEntry;
const newer = { id: "newer", createdAt: "2026-01-02T00:00:00.000Z" } satisfies InboxEntry;

test("Inbox entries order running work before recency", () => {
  const workspace = {
    ...createEmptyWorkspaceState(),
    inboxEntries: [older, newer],
    sessionStates: { older: { status: "running" as const } },
  };

  expect(
    inboxQueries
      .list()
      .select?.(workspace)
      .map(({ id }) => id),
  ).toEqual(["older", "newer"]);
});
