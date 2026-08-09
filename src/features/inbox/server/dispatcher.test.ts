import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as streamModule from "@sessions/server/runtime";
import * as workspaceModule from "@workspace/server/state";
import type { SessionCompletion } from "@sessions/model";
import type { InboxEntry } from "../model";
import * as databaseModule from "./database";

const realStreamModule = { ...streamModule };
const realWorkspaceModule = { ...workspaceModule };
const realDatabaseModule = { ...databaseModule };

let completion: ReturnType<typeof deferred<SessionCompletion>>;
let entry: InboxEntry | null;
const calls: string[] = [];

const createSessionMock = mock(async (sessionId: string) => {
  calls.push(`session:${sessionId}`);
  return {
    disposition: "started" as const,
    waitForCompletion: () => completion.promise,
  };
});
const createInboxEntryMock = mock(async (sessionId: string) => {
  calls.push(`inbox:${sessionId}`);
  entry = { id: sessionId, createdAt: new Date().toISOString() };
  return entry;
});
const getInboxEntryMock = mock(async (_sessionId: string) => entry);
const hasInboxEntryMock = mock(async (_sessionId: string) => entry !== null);
const deleteSessionIfExistsMock = mock(async (sessionId: string) => {
  calls.push(`delete-session:${sessionId}`);
  return true;
});
const deleteInboxEntryMock = mock(async (sessionId: string) => {
  calls.push(`delete-inbox:${sessionId}`);
  entry = null;
  return true;
});

mock.module("@sessions/server/runtime", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));
mock.module("@workspace/server/state", () => ({
  ...realWorkspaceModule,
  setSessionStatus: mock(() => {}),
}));
mock.module("./database", () => ({
  ...realDatabaseModule,
  createInboxEntry: createInboxEntryMock,
  getInboxEntry: getInboxEntryMock,
  hasInboxEntry: hasInboxEntryMock,
  deleteInboxEntry: deleteInboxEntryMock,
}));

const { dispatchInboxTask } = await import("./dispatcher");

afterAll(() => {
  mock.module("@sessions/server/runtime", () => realStreamModule);
  mock.module("@workspace/server/state", () => realWorkspaceModule);
  mock.module("./database", () => realDatabaseModule);
});

beforeEach(() => {
  completion = deferred<SessionCompletion>();
  entry = null;
  calls.length = 0;
  createSessionMock.mockClear();
  createSessionMock.mockImplementation(async (sessionId) => {
    calls.push(`session:${sessionId}`);
    return { disposition: "started", waitForCompletion: () => completion.promise };
  });
  createInboxEntryMock.mockClear();
  getInboxEntryMock.mockClear();
  hasInboxEntryMock.mockClear();
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

    const sessionId = createInboxEntryMock.mock.calls[0]![0];
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
