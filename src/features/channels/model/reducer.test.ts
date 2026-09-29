import { describe, expect, test } from "bun:test";
import { machineFile } from "@files/model";
import type { ChannelEvent, ChannelState } from ".";
import { channelLead } from ".";
import { mergeChannelMessages, reduceChannelState } from "./reducer";

function state(): ChannelState {
  return { revision: 0, lead: channelLead("lead"), members: [], messages: [], artifacts: [] };
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
      channelId: "channel",
      id: "reviewer-session",
      name: "Reviewer",
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
      agentId: member.id,
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
    expect(shared.artifacts).toEqual([{ ...artifact, sharedAt: "2026-09-05T12:01:00.000Z" }]);
    expect(left.members).toEqual([]);
    expect(left.messages.map(({ id }) => id)).toEqual(["joined", "shared", "left"]);
  });

  test("sharing an artifact again retitles it but keeps when it was first shared", () => {
    const file = machineFile("/workspace/plan.md");
    const share = (sequence: number, title: string, timestamp: string): ChannelEvent => ({
      type: "message",
      revision: sequence,
      message: {
        id: `shared-${sequence}`,
        sequence,
        sender: { type: "system" },
        content: { type: "artifact_shared", actor: { type: "user" }, artifact: { file, title } },
        timestamp,
      },
    });
    const first = reduceChannelState(state(), share(1, "Plan", "2026-09-05T12:00:00.000Z"));
    const again = reduceChannelState(first, share(2, "Release plan", "2026-09-05T13:00:00.000Z"));

    expect(again.artifacts).toEqual([
      { file, title: "Release plan", sharedAt: "2026-09-05T12:00:00.000Z" },
    ]);
  });

  test("member edits replace the profile without duplicating membership or changing the transcript", () => {
    const member = { channelId: "channel", id: "reviewer", name: "Reviewer" };
    const other = { ...member, id: "builder", name: "Builder" };
    const current = {
      ...state(),
      members: [{ ...member, role: "Old role" }, other],
      messages: [
        {
          id: "request",
          sequence: 1,
          sender: { type: "user" as const },
          content: "Review the plan.",
          timestamp: "2026-09-05T12:00:00.000Z",
        },
      ],
    };
    const updated = { ...member, name: "Critic" };
    const next = reduceChannelState(current, { type: "member", revision: 1, member: updated });

    expect(next).toEqual({
      ...current,
      revision: 1,
      members: expect.arrayContaining([other, updated]),
    });
    expect(next.members).toHaveLength(2);
    expect(current.members).toEqual([{ ...member, role: "Old role" }, other]);
  });

  test("reduces lead status without adding the lead to members", () => {
    const working = reduceChannelState(state(), {
      type: "status",
      revision: 1,
      agentId: "lead",
      status: { state: "working", text: "Shaping the plan" },
    });

    expect(working.lead.status).toEqual({ state: "working", text: "Shaping the plan" });
    expect(working.members).toEqual([]);
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
