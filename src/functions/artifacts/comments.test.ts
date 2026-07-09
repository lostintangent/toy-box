import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  onTestFinished,
  spyOn,
  test,
} from "bun:test";
import { join } from "node:path";
import * as sdkClientModule from "@/functions/sdk/client";
import * as streamModule from "@/functions/runtime/stream";
import * as sessionRegistryModule from "@/functions/state/session/registry";
import * as snapshotsModule from "@/functions/state/session/snapshots";
import * as artifactPathsModule from "@/functions/artifacts/paths";
import type { ArtifactCommentInput } from "@/functions/artifacts";
import type { SessionSnapshot, WorkspaceEvent } from "@/types";

const realSdkClientModule = { ...sdkClientModule };
const realStreamModule = { ...streamModule };
const realSessionRegistryModule = { ...sessionRegistryModule };
const realSnapshotsModule = { ...snapshotsModule };
const realArtifactPathsModule = { ...artifactPathsModule };

type Completion = { status: "completed" | "failed" };
type CreateArguments = Parameters<typeof streamModule.createSession>;

let completions: Promise<Completion>[];
let sourceIsLive: boolean;
const model = { name: "gpt-5", reasoningEffort: "high" as const };
const context = { workingDirectory: "/repo" };
const snapshot: SessionSnapshot = {
  id: "toy-box-parent",
  messages: [],
  queuedMessages: [],
  model,
  status: "idle",
  reasoningContent: "",
};
const createSessionMock = mock(async (..._args: CreateArguments) => {
  const completion = completions.shift() ?? Promise.resolve({ status: "completed" as const });
  return {
    disposition: "started" as const,
    waitForCompletion: () => completion,
  };
});
const deleteSessionIfExistsMock = mock(async () => true);
const loadSessionSnapshotMock = mock(async () => snapshot);

mock.module("@/functions/sdk/client", () => ({
  ...realSdkClientModule,
  readSessionContext: async () => context,
}));
mock.module("@/functions/runtime/stream", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
  SessionStream: {
    get: () => (sourceIsLive ? { getSessionState: () => ({ model }) } : undefined),
  },
}));
mock.module("@/functions/state/session/registry", () => ({
  ...realSessionRegistryModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));
mock.module("@/functions/state/session/snapshots", () => ({
  ...realSnapshotsModule,
  loadSessionSnapshot: loadSessionSnapshotMock,
}));
mock.module("@/functions/artifacts/paths", () => ({
  ...realArtifactPathsModule,
  resolveArtifactPath: async (_sessionId: string, path: string) =>
    path === "other.md" ? join(import.meta.dir, "../../../package.json") : import.meta.path,
}));

const { buildArtifactCommentPrompt, respondToArtifactComment } = await import("./comments");
const { hasArtifactCommentSession, unlinkArtifactCommentSession } =
  await import("@/functions/state/workspace");
const { subscribeWorkspaceEvents } = await import("@/functions/runtime/broadcast");

afterAll(() => {
  mock.module("@/functions/sdk/client", () => realSdkClientModule);
  mock.module("@/functions/runtime/stream", () => realStreamModule);
  mock.module("@/functions/state/session/registry", () => realSessionRegistryModule);
  mock.module("@/functions/state/session/snapshots", () => realSnapshotsModule);
  mock.module("@/functions/artifacts/paths", () => realArtifactPathsModule);
});

beforeEach(() => {
  completions = [];
  sourceIsLive = true;
  createSessionMock.mockClear();
  deleteSessionIfExistsMock.mockClear();
  loadSessionSnapshotMock.mockClear();
});

const comment: ArtifactCommentInput = {
  sessionId: "toy-box-parent",
  path: "plan.md",
  threadId: "thread-a",
  thread: {
    quote: "Original section",
    anchor: { prefix: "Original section" },
    comments: [{ body: "@[Copilot](copilot) make this clearer", updatedAt: "earlier" }],
  },
};

describe("artifact comment sessions", () => {
  test("returns after enqueueing and exposes the worker through workspace events", async () => {
    const completion = deferred<Completion>();
    completions.push(completion.promise);
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeWorkspaceEvents((event) => {
      if (event.type.startsWith("artifact.comment_session.")) events.push(event);
    });
    onTestFinished(unsubscribe);

    const { sessionId } = await respondToArtifactComment(comment);
    onTestFinished(() => unlinkArtifactCommentSession(sessionId));

    expect(hasArtifactCommentSession(sessionId)).toBe(true);
    expect(events).toEqual([
      {
        type: "artifact.comment_session.linked",
        commentSession: {
          sessionId,
          sourceSessionId: comment.sessionId,
          path: comment.path,
          threadId: comment.threadId,
        },
      },
    ]);

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    const [workerSessionId, message, creation] = createSessionMock.mock.calls[0]!;
    expect(workerSessionId).toBe(sessionId);
    expect(message).toMatchObject({ model });
    expect(creation).toEqual({
      directory: context.workingDirectory,
      initialContext: context,
      parentSessionId: comment.sessionId,
      useWorktree: false,
    });

    completion.resolve({ status: "completed" });
    await waitFor(() => expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionId));
    expect(hasArtifactCommentSession(sessionId)).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "artifact.comment_session.unlinked",
      sessionId,
    });
    expect(loadSessionSnapshotMock).not.toHaveBeenCalled();
  });

  test("serializes comment sessions for the same artifact", async () => {
    const first = deferred<Completion>();
    const second = deferred<Completion>();
    completions.push(first.promise, second.promise);

    const firstSession = await respondToArtifactComment(comment);
    const secondSession = await respondToArtifactComment({ ...comment, threadId: "thread-b" });
    onTestFinished(() => unlinkArtifactCommentSession(firstSession.sessionId));
    onTestFinished(() => unlinkArtifactCommentSession(secondSession.sessionId));

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    expect(createSessionMock.mock.calls[0]![0]).toBe(firstSession.sessionId);

    first.resolve({ status: "completed" });
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(2));
    expect(createSessionMock.mock.calls[1]![0]).toBe(secondSession.sessionId);

    second.resolve({ status: "completed" });
    await waitFor(() => expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(2));
  });

  test("allows comment sessions for different artifacts to run concurrently", async () => {
    const first = deferred<Completion>();
    const second = deferred<Completion>();
    completions.push(first.promise, second.promise);

    const firstSession = await respondToArtifactComment(comment);
    const secondSession = await respondToArtifactComment({
      ...comment,
      path: "other.md",
      threadId: "thread-b",
    });
    onTestFinished(() => unlinkArtifactCommentSession(firstSession.sessionId));
    onTestFinished(() => unlinkArtifactCommentSession(secondSession.sessionId));

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(2));
    first.resolve({ status: "completed" });
    second.resolve({ status: "completed" });
    await waitFor(() => expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(2));
  });

  test("inherits the model from an idle source session", async () => {
    sourceIsLive = false;

    const { sessionId } = await respondToArtifactComment(comment);
    onTestFinished(() => unlinkArtifactCommentSession(sessionId));
    await waitFor(() => expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionId));

    expect(createSessionMock.mock.calls[0]![1]).toMatchObject({ model });
    expect(loadSessionSnapshotMock).toHaveBeenCalledWith(comment.sessionId);
  });

  test("uses an Inbox artifact's entry ID as its source session", async () => {
    const input = {
      ...comment,
      sessionId: "toy-box-inbox",
      path: "report.md",
    };

    const { sessionId } = await respondToArtifactComment(input);
    onTestFinished(() => unlinkArtifactCommentSession(sessionId));
    await waitFor(() => expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionId));

    expect(createSessionMock.mock.calls[0]![2]?.parentSessionId).toBe(input.sessionId);
  });

  test("cleans up the association and worker when creation fails", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    createSessionMock.mockImplementationOnce(async () => {
      throw new Error("Unable to create.");
    });

    const { sessionId } = await respondToArtifactComment(comment);
    onTestFinished(() => unlinkArtifactCommentSession(sessionId));
    await waitFor(() => expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(sessionId));

    expect(hasArtifactCommentSession(sessionId)).toBe(false);
    expect(log).toHaveBeenCalled();
  });
});

describe("artifact comment prompt", () => {
  test("makes the artifact and comment thread the durable response", () => {
    const prompt = buildArtifactCommentPrompt(
      comment,
      "/tmp/session/files/plan.md",
      new Date("2026-07-14T12:00:00.000Z"),
    );

    expect(prompt).toContain("A user asked for your help in an inline comment thread");
    expect(prompt).toContain("/tmp/session/files/plan.md");
    expect(prompt).toContain("@[Copilot](copilot) make this clearer");
    expect(prompt).toContain('Use "2026-07-14T12:00:00.000Z" for `updatedAt`');
    expect(prompt).toContain("appending that object must be the only file change");
    expect(prompt).toContain("update its `quote` to the replacement text");
    expect(prompt).toContain(
      "Inspect other files whenever the latest comment requires additional context",
    );
    expect(prompt).toContain("Do not leave the substantive answer only in your final response");
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
