import { describe, expect, test } from "bun:test";
import { channelMessageReactions } from "./reactions";

const message = { sequence: 7, reactions: [{ agentId: "critic", reaction: "agree" as const }] };

function working(id: string, target: { lookingAt?: number; workingOn?: number }) {
  return { id, status: { state: "working", text: "Reviewing the lift", ...target } } as const;
}

describe("channel message reactions", () => {
  test("recorded reactions come first, then working agents' activity on the message", () => {
    expect(
      channelMessageReactions(
        message,
        [working("engine", { lookingAt: 7 }), working("files", { workingOn: 7 })],
        { engine: { state: "working" }, files: { state: "working" } },
      ),
    ).toEqual([
      { agentId: "critic", reaction: "agree" },
      { agentId: "engine", reaction: "looking" },
      { agentId: "files", reaction: "working" },
    ]);
  });

  test("other targets, waiting agents, and stale working status add no activity", () => {
    expect(
      channelMessageReactions(
        message,
        [
          working("engine", { lookingAt: 6 }),
          { id: "files", status: { state: "waiting", text: "Your call on the palette" } },
          working("stale", { workingOn: 7 }),
        ],
        {
          engine: { state: "working" },
          files: { state: "waiting", text: "Your call" },
          stale: { state: "idle" },
        },
      ),
    ).toEqual([{ agentId: "critic", reaction: "agree" }]);
  });
});
