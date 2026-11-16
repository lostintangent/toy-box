import { describe, expect, test } from "bun:test";
import type { Message, ToolCall } from "@sessions/model";
import { turns } from "./view";

const at = (second: number) => new Date(Date.UTC(2026, 0, 1) + second * 1_000).toISOString();
const input = (second: number, content = "wake"): Message => ({
  role: "user",
  content,
  timestamp: at(second),
});
const called = (name: string, result: ToolCall["result"] = { content: "", success: true }) =>
  ({
    role: "assistant",
    content: "",
    toolCalls: [{ id: name, name, arguments: {}, result }],
  }) as Message;
const agent = (messages: Message[], runs: number[], rests: number[]) =>
  turns({ id: "lead", name: "lead", runs: runs.map(at), rests: rests.map(at), messages });

describe("turns", () => {
  test("a wake delivered while the agent runs stays in that turn", () => {
    const [turn, ...rest] = agent(
      [input(1), called("read_channel"), input(5, "steer"), called("finish_agent_turn")],
      [0],
      [9],
    );
    expect(rest).toEqual([]);
    expect(turn!.inputs.map((message) => message.content)).toEqual(["wake", "steer"]);
    expect(turn!.calls.map((call) => call.name)).toEqual(["read_channel", "finish_agent_turn"]);
  });

  test("an input after a rest begins the next turn, and the run's end cuts the last one off", () => {
    const split = agent(
      [input(1), called("read_channel"), input(21), called("send_channel_message")],
      [0, 20],
      [9],
    );
    expect(split.map((turn) => [turn.end, turn.calls.map((call) => call.name)])).toEqual([
      [Date.parse(at(9)), ["read_channel"]],
      [undefined, ["send_channel_message"]],
    ]);
  });

  test("a wake recorded just before its run starts begins that run", () => {
    const split = agent(
      [input(1), called("read_channel"), input(19.996), called("send_channel_message")],
      [0, 20],
      [9],
    );
    expect(split.map((turn) => turn.calls.map((call) => call.name))).toEqual([
      ["read_channel"],
      ["send_channel_message"],
    ]);
  });

  test("a tool loses its MCP server prefix and keeps whether it failed", () => {
    const failed = { content: "", success: false };
    const [turn] = agent([input(1), called("mcp__toy-box__edit_channel_tasks", failed)], [0], [9]);
    expect(turn!.calls).toEqual([
      { name: "edit_channel_tasks", args: {}, result: "", failed: true, added: [] },
    ]);
  });

  test("a file edit keeps the lines its diff added, and a shell command keeps none", () => {
    const details =
      "--- a/notes.md\n+++ b/notes.md\n@@ -1,2 +1,2 @@\n # Notes\n-TBD\n+One notes.json";
    const [turn] = agent(
      [
        input(1),
        called("edit", { content: "", success: true, details }),
        called("bash", { content: "", success: true, details }),
      ],
      [0],
      [9],
    );
    expect(turn!.calls.map((call) => call.added)).toEqual([["One notes.json"], []]);
  });
});
