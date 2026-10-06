import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from ".";
import { channelRequestStates } from "./requests";

const timestamp = "2026-09-26T15:00:00.000Z";

function userPost(sequence: number): ChannelMessage {
  return { id: `${sequence}`, sequence, timestamp, sender: { type: "user" }, content: "The app." };
}

function request(sequence: number): ChannelMessage {
  return {
    id: `${sequence}`,
    sequence,
    timestamp,
    sender: { type: "agent", agentId: "lead" },
    content: "Which should I build?",
    request: true,
  };
}

describe("channel request states", () => {
  test("a request stays pending until a later user message", () => {
    const asked = [request(1)];
    expect(channelRequestStates(asked)).toEqual(new Map([[1, "pending"]]));
    expect(channelRequestStates([...asked, userPost(3)])).toEqual(new Map([[1, "acknowledged"]]));
  });

  test("a later request pends while an earlier reply keeps acknowledging its own", () => {
    const messages = [request(1), userPost(3), request(4)];
    expect(channelRequestStates(messages)).toEqual(
      new Map([
        [1, "acknowledged"],
        [4, "pending"],
      ]),
    );
  });
});
