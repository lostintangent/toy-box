import { expect, test } from "bun:test";
import type { Attachment, SessionMessage } from "@sessions/model";
import { decodeInput, encodeInput } from "./messages";

test("images and system notifications round trip through native message content", () => {
  const attachments: Attachment[] = ["image/png", "image/jpeg", "image/gif", "image/webp"].map(
    (mimeType) => ({ mimeType, base64: Buffer.from("fixture").toString("base64") }),
  );
  const message: SessionMessage = {
    role: "user",
    clientId: "client",
    content: "Review these",
    attachments,
  };
  expect(decodeInput(encodeInput(message), "client", "time")).toEqual({
    type: "user_message",
    content: message.content,
    attachments,
    clientId: "client",
    timestamp: "time",
    rewindable: false,
  });
  const notification: SessionMessage = {
    role: "system",
    clientId: "edit",
    content: { type: "file_edited", file: { kind: "session", sessionId: "test", path: "note.md" } },
  };
  expect(decodeInput(encodeInput(notification), "edit", "time")).toEqual({
    type: "system_message",
    content: notification.content,
    clientId: "edit",
    timestamp: "time",
  });
});

test("a persisted skill invocation displays its original slash prompt", () => {
  expect(
    decodeInput(
      "<command-message>plugin:skill</command-message>\n<command-name>/plugin:skill</command-name>\n<command-args>Make an app</command-args>",
    ),
  ).toMatchObject({
    type: "user_message",
    content: "/plugin:skill Make an app",
  });
});
