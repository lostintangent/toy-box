import { describe, expect, test } from "bun:test";
import {
  createDraftSessionInputSchema,
  deliverMessageInputSchema,
  sessionLaunchSchema,
  listSkillsInputSchema,
  streamSessionRequestSchema,
  waitForSessionInputSchema,
} from "./protocol";

const attachment = {
  displayName: "image.png",
  mimeType: "image/png",
  base64: "aW1hZ2U=",
};

describe("session protocol", () => {
  test("accepts a draft with an optional artifact", () => {
    const sessionId = "toy-box-01234567-89ab-4def-8abc-0123456789ab";
    expect(createDraftSessionInputSchema.parse({ sessionId })).toEqual({ sessionId });
    expect(
      createDraftSessionInputSchema.parse({
        sessionId,
        artifact: { path: "document.md", content: "" },
      }),
    ).toEqual({
      sessionId,
      artifact: { path: "document.md", content: "" },
    });
  });

  test("streams subscription-only and message requests with an optional location", () => {
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
        location: { directory: "/repo", useWorktree: true },
      }),
    ).toMatchObject({
      message: { content: "", attachments: [attachment] },
      location: { directory: "/repo", useWorktree: true },
    });
  });

  test("rejects location without a message and empty messages without attachments", () => {
    expect(
      streamSessionRequestSchema.safeParse({ sessionId: "session", location: {} }).success,
    ).toBe(false);
    expect(
      streamSessionRequestSchema.safeParse({ sessionId: "session", message: { content: " " } })
        .success,
    ).toBe(false);
  });

  test("uses the same message shape for headless creation and delivery", () => {
    const message = { id: "message", content: "hello", attachments: [attachment] };

    expect(
      sessionLaunchSchema.parse({
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
      sessionLaunchSchema.parse({ message, directory: "/repo", useWorktree: true }),
    ).toMatchObject({ message, directory: "/repo", useWorktree: true });
    expect(deliverMessageInputSchema.parse({ sessionId: "session", message })).toMatchObject({
      sessionId: "session",
      message,
    });
  });

  test("accepts a bounded optional session wait timeout", () => {
    expect(waitForSessionInputSchema.parse({ sessionId: "session" })).toEqual({
      sessionId: "session",
    });
    expect(waitForSessionInputSchema.parse({ sessionId: "session", timeoutMs: 300_000 })).toEqual({
      sessionId: "session",
      timeoutMs: 300_000,
    });
    expect(
      waitForSessionInputSchema.safeParse({ sessionId: "session", timeoutMs: 300_001 }).success,
    ).toBe(false);
  });

  test("accepts a working directory or host-level skill discovery", () => {
    expect(listSkillsInputSchema.parse({ cwd: "/repo" })).toEqual({ cwd: "/repo" });
    expect(listSkillsInputSchema.parse({ cwd: "/repo", sessionType: "hyper" })).toEqual({
      cwd: "/repo",
      sessionType: "hyper",
    });
    expect(listSkillsInputSchema.parse({})).toEqual({});
    expect(listSkillsInputSchema.safeParse({ cwd: "" }).success).toBe(false);
    expect(listSkillsInputSchema.safeParse({ sessionType: "custom" }).success).toBe(false);
  });
});
