import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as streamModule from "@/functions/runtime/stream";
import * as registryModule from "@/functions/state/session/registry";
import * as workspaceModule from "@/functions/state/workspace";
import * as inboxStateModule from "@/functions/state/workspace/inbox";
import type { SessionStreamCompletion } from "@/functions/runtime/stream";
import type { InboxEntry } from "@/types";

const realStreamModule = { ...streamModule };
const realRegistryModule = { ...registryModule };
const realWorkspaceModule = { ...workspaceModule };
const realInboxStateModule = { ...inboxStateModule };

let completion: ReturnType<typeof deferred<SessionStreamCompletion>>;
let entry: InboxEntry | null;
const calls: string[] = [];

const createSessionMock = mock(async (sessionId: string) => {
  calls.push(`session:${sessionId}`);
  return {
    disposition: "started" as const,
    waitForCompletion: () => completion.promise,
  };
});
const createPendingInboxEntryMock = mock(async (sessionId: string) => {
  calls.push(`inbox:${sessionId}`);
  entry = { id: sessionId, createdAt: new Date().toISOString() };
  return entry;
});
const getInboxEntryMock = mock(async (_sessionId: string) => entry);
const deleteSessionIfExistsMock = mock(async (sessionId: string) => {
  calls.push(`delete-session:${sessionId}`);
  return true;
});
const deleteInboxEntryMock = mock(async (sessionId: string) => {
  calls.push(`delete-inbox:${sessionId}`);
  entry = null;
  return true;
});

mock.module("@/functions/runtime/stream", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
}));
mock.module("@/functions/state/session/registry", () => ({
  ...realRegistryModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));
mock.module("@/functions/state/workspace", () => ({
  ...realWorkspaceModule,
  createPendingInboxEntry: createPendingInboxEntryMock,
  deleteInboxEntry: deleteInboxEntryMock,
}));
mock.module("@/functions/state/workspace/inbox", () => ({
  ...realInboxStateModule,
  getInboxEntry: getInboxEntryMock,
}));

const { dispatchInboxTask } = await import("./dispatcher");

afterAll(() => {
  mock.module("@/functions/runtime/stream", () => realStreamModule);
  mock.module("@/functions/state/session/registry", () => realRegistryModule);
  mock.module("@/functions/state/workspace", () => realWorkspaceModule);
  mock.module("@/functions/state/workspace/inbox", () => realInboxStateModule);
});

beforeEach(() => {
  completion = deferred<SessionStreamCompletion>();
  entry = null;
  calls.length = 0;
  createSessionMock.mockClear();
  createSessionMock.mockImplementation(async (sessionId) => {
    calls.push(`session:${sessionId}`);
    return { disposition: "started", waitForCompletion: () => completion.promise };
  });
  createPendingInboxEntryMock.mockClear();
  getInboxEntryMock.mockClear();
  deleteSessionIfExistsMock.mockClear();
  deleteInboxEntryMock.mockClear();
});

describe("dispatchInboxTask", () => {
  test("claims Inbox ownership before opening an Inbox session", async () => {
    const result = await dispatchInboxTask({
      message: { content: "Research this", model: { name: "gpt-5" } },
      directory: "/repo",
      useWorktree: false,
    });

    expect(result.sessionId).toStartWith("toy-box-");
    expect(calls).toEqual([`inbox:${result.sessionId}`, `session:${result.sessionId}`]);
    expect(createSessionMock).toHaveBeenCalledWith(
      result.sessionId,
      { content: "Research this", model: { name: "gpt-5" } },
      {
        directory: "/repo",
        useWorktree: false,
        sessionType: "inbox",
      },
    );

    entry = { ...entry!, message: "Research complete" };
    completion.resolve({ status: "completed" });
    await waitFor(() => expect(getInboxEntryMock).toHaveBeenCalledTimes(1));

    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
    expect(deleteInboxEntryMock).not.toHaveBeenCalled();
  });

  test("removes a completed session that produced no Inbox result", async () => {
    const { sessionId } = await dispatchInboxTask({ message: { content: "Update files" } });
    completion.resolve({ status: "completed" });
    await waitFor(() => expect(deleteInboxEntryMock).toHaveBeenCalledTimes(1));

    expect(calls.slice(-2)).toEqual([`delete-session:${sessionId}`, `delete-inbox:${sessionId}`]);
  });

  test("retains failed sessions and their pending Inbox task", async () => {
    await dispatchInboxTask({ message: { content: "Try this" } });
    completion.resolve({ status: "failed", response: "Unable to finish" });
    await Bun.sleep(0);

    expect(getInboxEntryMock).not.toHaveBeenCalled();
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
    expect(deleteInboxEntryMock).not.toHaveBeenCalled();
  });

  test("cleans up both ownership and partial session state when creation fails", async () => {
    const creationError = new Error("Unable to create session");
    createSessionMock.mockImplementationOnce(async () => {
      throw creationError;
    });

    await expect(dispatchInboxTask({ message: { content: "Start this" } })).rejects.toBe(
      creationError,
    );

    const sessionId = createPendingInboxEntryMock.mock.calls[0]![0];
    expect(calls).toEqual([
      `inbox:${sessionId}`,
      `delete-session:${sessionId}`,
      `delete-inbox:${sessionId}`,
    ]);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (cause) {
      error = cause;
      await Bun.sleep(5);
    }
  }
  throw error;
}
