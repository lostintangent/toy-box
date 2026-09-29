import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from ".";
import { channelRequestStates } from "./requests";

const timestamp = "2026-09-26T15:00:00.000Z";

function agentPost(sequence: number): ChannelMessage {
  const sender = { type: "agent", agentId: "lead" } as const;
  return { id: `${sequence}`, sequence, timestamp, sender, content: "Which should I build?" };
}

function userPost(sequence: number): ChannelMessage {
  return { id: `${sequence}`, sequence, timestamp, sender: { type: "user" }, content: "The app." };
}

function request(sequence: number, requestSequence: number): ChannelMessage {
  return {
    id: `${sequence}`,
    sequence,
    timestamp,
    sender: { type: "system" },
    content: { type: "user_attention_requested", requestSequence },
  };
}

describe("channel request states", () => {
  test("a request is pending until the user posts after the message it references", () => {
    const asked = [agentPost(1), request(2, 1)];
    expect(channelRequestStates(asked)).toEqual(new Map([[1, "pending"]]));
    expect(channelRequestStates([...asked, userPost(3)])).toEqual(new Map([[1, "acknowledged"]]));
  });

  test("a reply between posting and registration already acknowledges the request", () => {
    const messages = [agentPost(1), userPost(2), request(3, 1)];
    expect(channelRequestStates(messages)).toEqual(new Map([[1, "acknowledged"]]));
  });

  test("a later request pends while an earlier reply keeps acknowledging its own", () => {
    const messages = [agentPost(1), request(2, 1), userPost(3), agentPost(4), request(5, 4)];
    expect(channelRequestStates(messages)).toEqual(
      new Map([
        [1, "acknowledged"],
        [4, "pending"],
      ]),
    );
  });
});
