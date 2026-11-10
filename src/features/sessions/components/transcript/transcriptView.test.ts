import { expect, test } from "bun:test";
import type { Message, ToolCall } from "../../model";
import { messagesInView } from "./transcriptView";

const tool: ToolCall = { id: "tool-1", name: "read", arguments: { path: "/repo/README.md" } };
const question: ToolCall = {
  id: "question-1",
  name: "ask_user",
  arguments: {},
  question: {
    question: "Which database?",
    allowFreeform: false,
    state: "answered",
    answer: "SQLite",
  },
};
const messages: Message[] = [
  {
    role: "user",
    content: "Build it",
    attachments: [{ mimeType: "image/png", base64: "aW1hZ2U=" }],
  },
  { role: "system", content: { type: "channel_message", senderName: "Teammate" } },
  { role: "assistant", content: "I'll inspect it.", toolCalls: [tool] },
  { role: "assistant", content: "", toolCalls: [tool] },
  { role: "assistant", content: "", toolCalls: [tool, question] },
  { role: "assistant", content: "", error: "Request failed", toolCalls: [tool] },
  { role: "assistant", content: "" },
  { role: "assistant", content: "Done" },
];

test("the full view preserves the canonical messages unchanged", () => {
  expect(messagesInView(messages, "all")).toEqual({ messages, positions: [...messages.keys()] });
});

test("responses retain conversation, questions, and errors in order without tool activity", () => {
  const { messages: visible, positions } = messagesInView(messages, "responses", 10);
  expect(positions).toEqual([10, 12, 14, 15, 17]);
  expect(visible).toMatchObject([
    messages[0],
    { role: "assistant", content: "I'll inspect it." },
    { role: "assistant", content: "", toolCalls: [question] },
    { role: "assistant", content: "", error: "Request failed" },
    { role: "assistant", content: "Done" },
  ]);
  expect(
    visible.flatMap((message) => (message.role === "assistant" ? (message.toolCalls ?? []) : [])),
  ).toEqual([question]);
  expect(messages[2]).toHaveProperty("toolCalls", [tool]);
  expect(messages[4]).toHaveProperty("toolCalls", [tool, question]);
});
