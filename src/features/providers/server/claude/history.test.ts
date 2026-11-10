import { expect, test } from "bun:test";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { applySessionEvent, createInitialSessionState } from "@sessions/model/reducer";
import { readClaudeHistory } from "./history";
import { createClaudeProjector } from "./projector";

// The SDK reads only sessions whose IDs are UUIDs.
const sessionId = "0b5f7c1e-3d2a-4e8b-9c6f-1a2b3c4d5e6f";
let second = 0;
const entry = (uuid: string, parentUuid: string | null, fields: object): SessionStoreEntry => ({
  uuid,
  parentUuid,
  sessionId,
  isSidechain: false,
  timestamp: new Date(Date.UTC(2026, 9, 17, 0, 0, second++)).toISOString(),
  type: "user",
  ...fields,
});
const prompt = (uuid: string, parentUuid: string | null, content: string, fields = {}) =>
  entry(uuid, parentUuid, { message: { role: "user", content }, ...fields });
const reply = (uuid: string, parentUuid: string, text: string) =>
  entry(uuid, parentUuid, {
    type: "assistant",
    message: {
      id: `message-${uuid}`,
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text }],
    },
  });

test("history keeps the conversation before a compaction, once and without its summary", async () => {
  // An automatic compaction that keeps the latest exchange, which the CLI relinks after its summary.
  const transcript = [
    prompt("prompt-1", null, "Lighthouses?"),
    reply("reply-1", "prompt-1", "They guide ships."),
    prompt("prompt-2", "reply-1", "Harbors?"),
    reply("reply-2", "prompt-2", "They shelter ships."),
    entry("boundary", null, {
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      logicalParentUuid: "reply-2",
      compactMetadata: {
        trigger: "auto",
        preTokens: 967_000,
        preservedMessages: { anchorUuid: "summary", uuids: ["prompt-2", "reply-2"] },
      },
    }),
    prompt("summary", "boundary", "This session is being continued from a previous conversation.", {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }),
    prompt("prompt-3", "reply-2", "Tides?"),
    reply("reply-3", "prompt-3", "They rise and fall."),
  ];

  const history = await readClaudeHistory(sessionId, (id, store) =>
    store.append({ projectKey: "test", sessionId: id }, transcript),
  );
  const state = history
    .flatMap(createClaudeProjector())
    .reduce(applySessionEvent, createInitialSessionState());

  expect(state.messages.map(({ role, content }) => [role, content])).toEqual([
    ["user", "Lighthouses?"],
    ["assistant", "They guide ships."],
    ["user", "Harbors?"],
    ["assistant", "They shelter ships."],
    ["user", "Tides?"],
    ["assistant", "They rise and fall."],
  ]);
});
