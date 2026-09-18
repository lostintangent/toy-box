import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { SessionMessage, SessionSystemMessage } from "@sessions/model";
import { systemMessagePrompt } from "@sessions/model/systemMessages";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeInput, encodeInput } from "./inputs";
import { codexHistoryEvents, createCodexProjector, itemTimestamp } from "./projector";
import type { Thread, ThreadItem, UserInput } from "./protocol";

const timestamp = "2026-09-14T00:00:00.000Z";
const userItem = (content: UserInput[]): Extract<ThreadItem, { type: "userMessage" }> => ({
  type: "userMessage",
  id: "native-item",
  clientId: "client-id",
  content,
});

test("native display spans preserve Unicode system messages through replay", async () => {
  const content: SessionSystemMessage = {
    type: "file_edited",
    file: { kind: "session", sessionId: "session", path: "résumé 🍣.md" },
  };
  const input = await encodeInput(
    "/tmp/attachments",
    { role: "system", clientId: "client-id", content },
    [],
  );
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

test("native input preserves skills and ordered attachments without staged files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toybox-codex-inputs-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const message: SessionMessage = {
    role: "user",
    clientId: "../../untrusted-client-id",
    content: "/review Inspect these\nwith spacing intact.  ",
    attachments: [
      { mimeType: "image/png", base64: "aW1hZ2U=" },
      { mimeType: "text/plain", base64: "bm90ZXM=" },
      { mimeType: "application/octet-stream", base64: "AAEC/w==" },
    ],
  };
  const input = await encodeInput(directory, message, [
    {
      name: "review",
      description: "Review changes",
      type: "global",
      path: "/skills/review/SKILL.md",
    },
  ]);
  expect(input).toContainEqual({ type: "skill", name: "review", path: "/skills/review/SKILL.md" });
  expect(input).toContainEqual({ type: "image", url: "data:image/png;base64,aW1hZ2U=" });
  for (const [index, entry] of input
    .filter((entry) => entry.type === "text")
    .slice(1)
    .entries()) {
    const path = entry.text.slice(entry.text.indexOf(": ") + 2);
    expect(path.startsWith(`${directory}/`)).toBe(true);
    expect(path).not.toContain("untrusted-client-id");
    expect(Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")).toBe(
      message.attachments![index + 1]!.base64,
    );
    await rm(path);
  }
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
  for (const placeholder of [
    "[Pasted text]",
    "toybox-system:{bad}",
    "toybox-attachment:{bad}",
    'toybox-attachment:{"mimeType":"image/png"}',
  ]) {
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
