import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import type { CopilotClient, SessionEvent as SdkEvent } from "@github/copilot-sdk";
import type { SessionEvent } from "@sessions/model";
import * as client from "./client";
import { copilotProvider, toSubscription } from "./provider";

test("a subscription meters premium requests only when its plan limits them", () => {
  const premium = {
    isUnlimitedEntitlement: false,
    entitlementRequests: 300,
    usedRequests: 75,
    usageAllowedWithExhaustedQuota: false,
    remainingPercentage: 75,
    overage: 0,
    overageAllowedWithExhaustedQuota: false,
    resetDate: "2026-11-01T00:00:00.000Z",
  };

  expect(toSubscription("individual", { premium_interactions: premium })).toEqual({
    plan: "individual",
    limits: [
      { name: "Premium requests", usedPercent: 25, resetsAt: Date.parse(premium.resetDate) },
    ],
  });
  expect(
    toSubscription("enterprise", {
      premium_interactions: { ...premium, isUnlimitedEntitlement: true },
    }),
  ).toEqual({ plan: "enterprise", limits: [] });
});

test("catalog metadata retains the native repository display fields", async () => {
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    listSessions: async () => [
      {
        sessionId: "native",
        startTime: new Date(0),
        modifiedTime: new Date(1),
        summary: "Repository session",
        context: {
          workingDirectory: "/repo/src",
          gitRoot: "/repo",
          repository: "owner/repo",
          branch: "main",
        },
      },
    ],
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  expect(await copilotProvider.listSessions()).toEqual([
    {
      nativeId: "native",
      createdAt: new Date(0),
      updatedAt: new Date(1),
      title: "Repository session",
      context: {
        directory: "/repo/src",
        gitRoot: "/repo",
        repository: "owner/repo",
        branch: "main",
      },
    },
  ]);
});

test("a limited catalog reads only the newest local sessions it needs", async () => {
  const entries = [
    { sessionId: "remote", isRemote: true },
    ...["first", "empty", "second", "older"].map((sessionId) => ({ sessionId, isRemote: false })),
  ];
  const read: string[] = [];
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    rpc: {
      sessions: {
        list: async () => ({ sessions: entries }),
        enrichMetadata: async ({ sessions }: { sessions: typeof entries }) => ({
          sessions: sessions.filter(({ sessionId }) => sessionId !== "empty"),
        }),
      },
    },
    getSessionMetadata: async (sessionId: string) => {
      read.push(sessionId);
      return { sessionId };
    },
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  expect((await copilotProvider.listSessions(2)).map(({ nativeId }) => nativeId)).toEqual([
    "first",
    "second",
  ]);
  expect(read).not.toContain("older");
});

test("creation uses the canonical ID and hands native start to the first subscriber", async () => {
  const createSession = mock(
    async ({ sessionId, onEvent }: { sessionId: string; onEvent: (event: SdkEvent) => void }) => {
      onEvent({
        type: "session.start",
        data: { selectedModel: "gpt-5.4-mini", reasoningEffort: "none" },
      } as SdkEvent);
      onEvent({
        type: "session.title_changed",
        ephemeral: true,
        data: { title: "Old" },
      } as SdkEvent);
      return { sessionId, on: () => () => {} };
    },
  );
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    createSession,
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  const connection = await copilotProvider.create("public", {
    directory: "/repo",
    allowUserQuestions: false,
    tools: [],
    instructions: "",
    skillDirectories: [],
  });

  expect(createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "public",
      workingDirectory: "/repo",
      imageGeneration: { enabled: true },
      permissionMode: "allow-all",
    }),
  );
  expect(connection.nativeId).toBe("public");
  const first: SessionEvent[] = [];
  const later: SessionEvent[] = [];
  connection.onEvent((event) => first.push(event));
  connection.onEvent((event) => later.push(event));
  expect(first).toEqual([
    {
      type: "model_changed",
      model: { provider: "copilot", name: "gpt-5.4-mini", reasoningEffort: "none" },
    },
  ]);
  expect(later).toEqual([]);
});

test("resume requests the configured model and tool loading from the native session", async () => {
  const resumeSession = mock(async (_id: string, _configuration: object) => ({
    sessionId: "native",
  }));
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    resumeSession,
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  await copilotProvider.resume("native", {
    model: {
      provider: "copilot",
      name: "gpt-6-luna",
      reasoningEffort: "max",
      contextTier: "long_context",
    },
    directory: "/repo",
    allowUserQuestions: false,
    tools: [
      { name: "deferred", handler: async () => "" },
      { name: "loaded", alwaysLoad: true, handler: async () => "" },
    ],
    instructions: "",
    skillDirectories: [],
  });

  expect(resumeSession).toHaveBeenCalledWith(
    "native",
    expect.objectContaining({
      tools: [
        expect.objectContaining({ name: "deferred", defer: "auto" }),
        expect.objectContaining({ name: "loaded", defer: "never" }),
      ],
      model: "gpt-6-luna",
      reasoningEffort: "max",
      contextTier: "long_context",
      imageGeneration: { enabled: true },
      permissionMode: "allow-all",
      onEvent: expect.any(Function),
    }),
  );
});

test("read-only history preserves attachments and projector state across native pages", async () => {
  const read = mock(async ({ cursor }: { cursor?: string }) => ({
    cursor: cursor ? "end" : "next",
    hasMore: !cursor,
    events: cursor
      ? [
          {
            type: "user.message",
            timestamp: "2026-09-14T00:00:00.000Z",
            data: {
              content: "Review the attachments",
              attachments: [
                { type: "blob", assetId: "sha256:image", mimeType: "image/png" },
                { type: "blob", data: "bm90ZXM=", mimeType: "text/plain" },
                { type: "file", assetId: "sha256:image", path: "/tmp/removed.png" },
              ],
            },
          },
        ]
      : [
          {
            type: "session.binary_asset",
            data: {
              assetId: "sha256:image",
              type: "image",
              data: "aW1hZ2U=",
              mimeType: "image/png",
              byteLength: 5,
            },
          },
        ],
  }));
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    rpc: { sessions: { readPersistedEvents: read } },
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  expect(await copilotProvider.readHistory("native")).toEqual([
    {
      type: "user_message",
      content: "Review the attachments",
      timestamp: "2026-09-14T00:00:00.000Z",
      attachments: [
        { mimeType: "image/png", base64: "aW1hZ2U=" },
        { mimeType: "text/plain", base64: "bm90ZXM=" },
        { mimeType: "image/png", base64: "aW1hZ2U=" },
      ],
    },
  ]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith({
    sessionId: "native",
    direction: "forward",
    max: 1000,
    cursor: "next",
  });
});

test("history is current through the trailing-flush window of its native modified time", async () => {
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    getSessionMetadata: async (sessionId: string) =>
      sessionId === "native" ? { modifiedTime: new Date(10_000) } : undefined,
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  expect(await copilotProvider.isHistoryCurrent("native", 8_000)).toBe(true);
  expect(await copilotProvider.isHistoryCurrent("native", 7_999)).toBe(false);
  expect(await copilotProvider.isHistoryCurrent("missing", 10_000)).toBe(false);
});

test("deleting a history that is already gone resolves, and other failures propagate", async () => {
  const histories = new Set(["native"]);
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    deleteSession: async (sessionId: string) => {
      if (sessionId === "locked")
        throw new Error(`Failed to delete session ${sessionId}: Permission denied`);
      if (!histories.delete(sessionId))
        throw new Error(
          `Failed to delete session ${sessionId}: Session file not found for ${sessionId}`,
        );
    },
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  await copilotProvider.delete("native");
  await copilotProvider.delete("native");
  expect(histories.size).toBe(0);
  await expect(copilotProvider.delete("locked")).rejects.toThrow("Permission denied");
});
