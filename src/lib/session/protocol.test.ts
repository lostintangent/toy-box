import { describe, expect, test } from "bun:test";
import {
  deliverMessageInputSchema,
  createSessionInputSchema,
  dispatchInboxTaskInputSchema,
  streamSessionRequestSchema,
} from "./protocol";

const attachment = {
  displayName: "image.png",
  mimeType: "image/png",
  base64: "aW1hZ2U=",
};

describe("session protocol", () => {
  test("streams observation-only, message, and create-with-message requests", () => {
    expect(streamSessionRequestSchema.parse({ sessionId: "session", afterEventId: 42 })).toEqual({
      sessionId: "session",
      afterEventId: 42,
    });
    expect(streamSessionRequestSchema.parse({ sessionId: "session", mode: "passive" })).toEqual({
      sessionId: "session",
      mode: "passive",
    });

    expect(
      streamSessionRequestSchema.parse({
        sessionId: "session",
        message: { id: "message", content: "hello" },
      }),
    ).toMatchObject({ message: { id: "message", content: "hello" } });

    expect(
      streamSessionRequestSchema.parse({
        sessionId: "session",
        message: { content: "", attachments: [attachment] },
        create: { directory: "/repo", useWorktree: true },
      }),
    ).toMatchObject({
      message: { content: "", attachments: [attachment] },
      create: { directory: "/repo", useWorktree: true },
    });
  });

  test("rejects creation without a message and empty messages without attachments", () => {
    expect(streamSessionRequestSchema.safeParse({ sessionId: "session", create: {} }).success).toBe(
      false,
    );
    expect(
      streamSessionRequestSchema.safeParse({ sessionId: "session", message: { content: " " } })
        .success,
    ).toBe(false);
  });

  test("uses the same message shape for headless creation and delivery", () => {
    const message = { id: "message", content: "hello", attachments: [attachment] };

    expect(
      createSessionInputSchema.parse({
        message,
        directory: "/repo",
        useWorktree: true,
      }),
    ).toMatchObject({
      message,
      directory: "/repo",
      useWorktree: true,
    });
    expect(
      dispatchInboxTaskInputSchema.parse({ message, directory: "/repo", useWorktree: true }),
    ).toMatchObject({ message, directory: "/repo", useWorktree: true });
    expect(deliverMessageInputSchema.parse({ sessionId: "session", message })).toMatchObject({
      sessionId: "session",
      message,
    });
  });
});
