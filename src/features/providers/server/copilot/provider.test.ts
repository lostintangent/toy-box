import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import type { CopilotClient } from "@github/copilot-sdk";
import * as client from "./client";
import { copilotProvider } from "./provider";

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
      id: "native",
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

test("creation uses the canonical ID and initializes the working directory", async () => {
  const setWorkingDirectory = mock(async (_input: { workingDirectory: string }) => {});
  const start = spyOn(client, "startCopilotClient").mockResolvedValue({
    createSession: async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      rpc: { metadata: { setWorkingDirectory } },
    }),
  } as unknown as CopilotClient);
  onTestFinished(() => start.mockRestore());

  const connection = await copilotProvider.create("public", {
    directory: "/repo",
    allowUserQuestions: false,
    tools: [],
    instructions: "",
    skillDirectories: [],
  });

  expect(setWorkingDirectory).toHaveBeenCalledWith({ workingDirectory: "/repo" });
  expect(connection.provider).toEqual({
    id: "copilot",
    sessionId: "public",
  });
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

  expect(
    await copilotProvider.readHistory({
      id: "public",
      provider: { id: "copilot", sessionId: "native" },
    }),
  ).toEqual([
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
