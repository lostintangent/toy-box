import { describe, expect, test } from "bun:test";
import { machineFile } from "@files/model";
import type { ChannelEvent, ChannelState } from ".";
import { mergeChannelMessages, reduceChannelState } from "./reducer";

function state(): ChannelState {
  return { revision: 0, members: [], messages: [], artifacts: [] };
}

describe("Channel state reducer", () => {
  test("applies ordered detail changes once", () => {
    const message = {
      id: "message",
      sequence: 1,
      sender: { type: "user" } as const,
      content: "Please review the plan.",
      timestamp: "2026-09-05T12:01:00.000Z",
    };
    const appended: ChannelEvent = {
      type: "message",
      revision: 1,
      message,
    };
    const reacted: ChannelEvent = {
      type: "reaction",
      revision: 2,
      sequence: 1,
      agentId: "reviewer",
      reaction: "agree",
    };

    const optimisticMessage = {
      ...message,
      timestamp: "2026-09-05T12:00:59.000Z",
    };
    const afterAppend = reduceChannelState({ ...state(), messages: [optimisticMessage] }, appended);
    const afterReaction = reduceChannelState(afterAppend, reacted);

    expect(afterAppend.messages).toEqual([message]);
    expect(afterReaction).toMatchObject({
      revision: 2,
      messages: [
        {
          id: "message",
          reactions: [{ agentId: "reviewer", reaction: "agree" }],
        },
      ],
    });
    expect(reduceChannelState(afterReaction, reacted)).toBe(afterReaction);
  });

  test("keeps the cached transcript contiguous across bounded state recovery", () => {
    const earlierMessage = {
      id: "earlier-message",
      sequence: 1,
      sender: { type: "user" } as const,
      content: "Earlier context.",
      timestamp: "2026-09-05T12:00:00.000Z",
    };
    const confirmedMessage = {
      ...earlierMessage,
      id: "confirmed-message",
      sequence: 2,
      content: "Current context.",
    };
    const optimisticMessage = {
      ...earlierMessage,
      id: "optimistic-message",
      sequence: 3,
      content: "Please review the plan.",
    };
    const current = {
      ...state(),
      revision: 2,
      messages: [earlierMessage, confirmedMessage, optimisticMessage],
    };
    const replacement = {
      ...state(),
      revision: 5,
      messages: [confirmedMessage],
    };

    const recovered = reduceChannelState(current, {
      type: "state",
      revision: replacement.revision,
      state: replacement,
    });

    expect(recovered).toEqual({
      ...replacement,
      messages: [earlierMessage, confirmedMessage, optimisticMessage],
    });

    const disconnected = {
      ...replacement,
      revision: 6,
      messages: [{ ...confirmedMessage, sequence: 100 }],
    };
    expect(
      reduceChannelState(current, {
        type: "state",
        revision: disconnected.revision,
        state: disconnected,
      }),
    ).toBe(disconnected);
  });

  test("reduces system messages and member status into current state", () => {
    const member = {
      host: { kind: "channel", channelId: "channel" } as const,
      agentId: "reviewer",
      sessionId: "reviewer-session",
    };
    const joined = reduceChannelState(state(), {
      type: "message",
      revision: 1,
      message: {
        id: "joined",
        sequence: 1,
        sender: { type: "system" },
        content: { type: "member_joined", member },
        timestamp: "2026-09-05T12:00:00.000Z",
      },
    });
    const working = reduceChannelState(joined, {
      type: "status",
      revision: 2,
      sessionId: member.sessionId,
      status: { state: "working", text: "Reviewing the protocol", lookingAt: 1 },
    });
    const artifact = {
      file: machineFile("/workspace/plan.md"),
      title: "Plan",
    };
    const shared = reduceChannelState(working, {
      type: "message",
      revision: 3,
      message: {
        id: "shared",
        sequence: 2,
        sender: { type: "system" },
        content: { type: "artifact_shared", actor: { type: "user" }, artifact },
        timestamp: "2026-09-05T12:01:00.000Z",
      },
    });
    const left = reduceChannelState(shared, {
      type: "message",
      revision: 4,
      message: {
        id: "left",
        sequence: 3,
        sender: { type: "system" },
        content: { type: "member_left", member },
        timestamp: "2026-09-05T12:02:00.000Z",
      },
    });

    expect(working.members).toEqual([
      {
        ...member,
        status: { state: "working", text: "Reviewing the protocol", lookingAt: 1 },
      },
    ]);
    expect(shared.artifacts).toEqual([artifact]);
    expect(left.members).toEqual([]);
    expect(left.messages.map(({ id }) => id)).toEqual(["joined", "shared", "left"]);
  });

  test("merges history by durable identity and sequence", () => {
    const message = {
      id: "message-2",
      sequence: 2,
      sender: { type: "user" } as const,
      content: "Current",
      timestamp: "2026-09-05T12:02:00.000Z",
    };
    const earlier = {
      ...message,
      id: "message-1",
      sequence: 1,
      content: "Earlier",
    };
    const stale = { ...message, content: "Stale" };

    expect(mergeChannelMessages([message], [earlier, stale])).toEqual([earlier, message]);
  });
});
