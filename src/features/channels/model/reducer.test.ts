import { describe, expect, test } from "bun:test";
import type { ChannelEvent, ChannelSnapshot } from ".";
import { reduceChannelSnapshot } from "./reducer";

function snapshot(): ChannelSnapshot {
  return { cursor: 0, members: [], messages: [], artifacts: [] };
}

describe("Channel snapshot reducer", () => {
  test("applies ordered detail changes once", () => {
    const message = {
      id: "message",
      sequence: 1,
      sender: { type: "user" } as const,
      content: "Please review the plan.",
      reactions: [],
      timestamp: "2026-09-05T12:01:00.000Z",
    };
    const appended: ChannelEvent = {
      type: "message",
      cursor: 1,
      message,
    };
    const reacted: ChannelEvent = {
      type: "reaction",
      cursor: 2,
      sequence: 1,
      agentId: "reviewer",
      reaction: "agree",
    };

    const optimisticMessage = {
      ...message,
      timestamp: "2026-09-05T12:00:59.000Z",
    };
    const afterAppend = reduceChannelSnapshot(
      { ...snapshot(), messages: [optimisticMessage] },
      appended,
    );
    const afterReaction = reduceChannelSnapshot(afterAppend, reacted);

    expect(afterAppend.messages).toEqual([message]);
    expect(afterReaction).toMatchObject({
      cursor: 2,
      messages: [{ id: "message", reactions: [{ agentId: "reviewer", reaction: "agree" }] }],
    });
    expect(reduceChannelSnapshot(afterReaction, reacted)).toBe(afterReaction);
  });

  test("preserves a locally inserted message across snapshot recovery", () => {
    const optimisticMessage = {
      id: "optimistic-message",
      sequence: 1,
      sender: { type: "user" } as const,
      content: "Please review the plan.",
      reactions: [],
      timestamp: "2026-09-05T12:01:00.000Z",
    };
    const current = { ...snapshot(), cursor: 2, messages: [optimisticMessage] };
    const replacement = {
      ...snapshot(),
      cursor: 5,
    };

    const recovered = reduceChannelSnapshot(current, {
      type: "snapshot",
      cursor: replacement.cursor,
      snapshot: replacement,
    });

    expect(recovered).toEqual({ ...replacement, messages: [optimisticMessage] });
  });
});
