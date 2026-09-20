import { expect, test } from "bun:test";
import type { SessionMessage, SessionSystemMessage } from "@sessions/model";
import { systemMessagePrompt } from "@sessions/model/systemMessages";
import { decodeInput, encodeInput } from "./messages";
import { codexHistoryEvents, createCodexProjector, itemTimestamp } from "./projector";
import type { Thread, ThreadItem, UserInput } from "./protocol";

const timestamp = "2026-09-14T00:00:00.000Z";
const userItem = (content: UserInput[]): Extract<ThreadItem, { type: "userMessage" }> => ({
  type: "userMessage",
  id: "native-item",
  clientId: "client-id",
  content,
});

test("native display spans preserve Unicode system messages through replay", () => {
  const content: SessionSystemMessage = {
    type: "file_edited",
    file: { kind: "session", sessionId: "session", path: "résumé 🍣.md" },
  };
  const input = encodeInput({ role: "system", clientId: "client-id", content }, []);
  expect(input).toEqual([
    {
      type: "text",
      text: systemMessagePrompt(content),
      text_elements: [
        {
          byteRange: { start: 0, end: Buffer.byteLength(systemMessagePrompt(content)) },
          placeholder: expect.any(String),
        },
      ],
    },
  ]);
  const item = userItem(JSON.parse(JSON.stringify(input)));
  const turn = { id: "turn", startedAt: 1000, items: [item] };
  const expected = {
    type: "system_message" as const,
    content,
    clientId: "client-id",
    timestamp: itemTimestamp(turn, 0),
  };
  const project = createCodexProjector("public");
  project({ method: "turn/started", params: { turn } });
  expect(project({ method: "item/started", params: { item, turnId: turn.id } })).toEqual([
    expected,
  ]);
  expect(
    codexHistoryEvents({ turns: [turn] } as Thread).flatMap(createCodexProjector("public")),
  ).toEqual([expected, { type: "end", reason: "idle" }]);
});

test("native input preserves skills and ordered images", () => {
  const message: SessionMessage = {
    role: "user",
    clientId: "client-id",
    content: "/review Inspect these\nwith spacing intact.  ",
    attachments: [
      { mimeType: "image/png", base64: "aW1hZ2U=" },
      { mimeType: "image/jpeg", base64: "anBlZw==" },
    ],
  };
  const input = encodeInput(message, [
    {
      name: "review",
      description: "Review changes",
      type: "global",
      path: "/skills/review/SKILL.md",
    },
  ]);
  expect(input).toContainEqual({ type: "skill", name: "review", path: "/skills/review/SKILL.md" });
  expect(input).toContainEqual({ type: "image", url: "data:image/png;base64,aW1hZ2U=" });
  expect(decodeInput(userItem(JSON.parse(JSON.stringify(input))), timestamp)).toEqual({
    type: "user_message",
    clientId: "client-id",
    timestamp,
    content: message.content,
    attachments: message.attachments,
  });
});

test("ordinary, malformed, and partial display spans cannot hide native user text", () => {
  const text = "ordinary user input";
  for (const placeholder of ["[Pasted text]", "toybox-system:{bad}"]) {
    expect(
      decodeInput(
        userItem([
          {
            type: "text",
            text,
            text_elements: [{ byteRange: { start: 0, end: Buffer.byteLength(text) }, placeholder }],
          },
        ]),
        timestamp,
      ),
    ).toMatchObject({ type: "user_message", content: text });
  }
  expect(
    decodeInput(
      userItem([
        {
          type: "text",
          text,
          text_elements: [
            {
              byteRange: { start: 1, end: Buffer.byteLength(text) },
              placeholder: 'toybox-system:{"type":"channel_message","senderName":"Ada"}',
            },
          ],
        },
      ]),
      timestamp,
    ),
  ).toMatchObject({ type: "user_message", content: text });
});
