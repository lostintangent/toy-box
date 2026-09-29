import { expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { InboxEntry } from "./model";
import { inboxQueries } from "./queries";
import { inboxMutations } from "./mutations";
import { createEmptySessionsState, sessionQueries } from "@sessions/queries";
import type { SessionsState } from "@sessions/model";

const entry = {
  id: "inbox-a",
  createdAt: "2026-08-01T12:00:00.000Z",
  kind: "result",
  message: "Finished task",
} satisfies InboxEntry;
const other = { ...entry, id: "inbox-b" };

test("successful and already-absent deletions remove only their entry and backing session", async () => {
  for (const result of [true, false]) {
    const client = new QueryClient();
    onTestFinished(() => client.clear());
    client.setQueryData(inboxQueries.listKey(), [entry, other]);
    const sessions = [entry, other].map(({ id }) => ({
      id,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    const retainedOwnership = { [other.id]: { type: "worker", parentSessionId: null } } as const;
    client.setQueryData<SessionsState>(sessionQueries.stateKey(), {
      ...createEmptySessionsState(),
      sessions,
      ownership: {
        [entry.id]: { type: "worker", parentSessionId: null },
        ...retainedOwnership,
      },
    });

    await new MutationObserver(client, {
      ...inboxMutations.deleteEntry(entry.id),
      mutationFn: async () => result,
    }).mutate();

    expect(client.getQueryData<InboxEntry[]>(inboxQueries.listKey())).toEqual([other]);
    expect(client.getQueryData<SessionsState>(sessionQueries.stateKey())).toEqual({
      ...createEmptySessionsState(),
      sessions: [sessions[1]!],
      ownership: retainedOwnership,
    });
  }
});
