import { describe, expect, test } from "bun:test";
import type { Agent, AgentMention } from "@agents/model";
import type { ChannelMember } from "./index";
import { resolveChannelAudience } from "./index";

const members: ChannelMember[] = [
  {
    host: { kind: "channel", channelId: "channel" },
    agentId: "agent-critic",
    sessionId: "session-critic",
    executionMode: "shared",
    seenThrough: 0,
  },
  {
    host: { kind: "channel", channelId: "channel" },
    agentId: "agent-builder",
    sessionId: "session-builder",
    executionMode: "worktree",
    seenThrough: 0,
  },
];

const agents: Agent[] = [
  {
    id: "agent-critic",
    name: "Critic",
    persona: "Challenge assumptions.",
    experiences: [],
  },
  {
    id: "agent-builder",
    name: "Builder",
    persona: "Build the change.",
    experiences: [],
  },
  {
    id: "agent-planner",
    name: "Planner",
    persona: "Plan the work.",
    experiences: [],
  },
];

const user = { type: "user" } as const;
const critic = {
  type: "agent",
  agentId: "agent-critic",
} as const;
function audience(
  content: string,
  sender: typeof user | typeof critic = user,
  agentMentions?: AgentMention[],
) {
  return resolveChannelAudience({ content, sender, members, agents, agentMentions });
}

describe("channel delivery policy", () => {
  test("a user broadcasts to the team unless addressing specific Agents", () => {
    expect(audience("Please review")).toEqual({ members, invitations: [] });
    expect(audience("@critic Please review")).toEqual({ members: [members[0]], invitations: [] });
    expect(audience("@everyone Please review")).toEqual({ members, invitations: [] });
    expect(audience("@critci Please review")).toEqual({ members: [], invitations: [] });
  });

  test("an Agent only wakes explicitly addressed peers and never itself", () => {
    expect(audience("Here is my review", critic)).toEqual({ members: [], invitations: [] });
    expect(audience("@critic @builder please check", critic)).toEqual({
      members: [members[1]],
      invitations: [],
    });
    expect(audience("@everyone please check", critic)).toEqual({
      members: [members[1]],
      invitations: [],
    });
  });

  test("both senders may invite a named Agent without inviting the whole roster", () => {
    for (const sender of [user, critic]) {
      expect(audience("@builder plan with @planner", sender)).toEqual({
        members: [members[1]],
        invitations: [agents[2]],
      });
      expect(audience("@everyone ask @planner too", sender)).toEqual({
        members: sender.type === "user" ? members : [members[1]],
        invitations: [agents[2]],
      });
    }
  });

  test("stable IDs preserve recipients even when an Agent has been renamed", () => {
    expect(audience("@old-name please review", user, [{ agentId: "agent-critic" }])).toEqual({
      members: [members[0]],
      invitations: [],
    });
    expect(audience("@critic please review", user, [])).toEqual({ members: [], invitations: [] });
    expect(
      audience("Please review", user, [
        { agentId: "agent-planner", initialExecutionMode: "worktree" },
      ]),
    ).toEqual({ members: [], invitations: [agents[2]] });
  });

  test("broadcast intent is preserved when the composer supplies no explicit IDs", () => {
    expect(audience("Please review", user, [])).toEqual({ members, invitations: [] });
    expect(audience("@everyone please review", critic, [])).toEqual({
      members: [members[1]],
      invitations: [],
    });
  });

  test("duplicate mentions and self-addresses do not produce duplicate work", () => {
    expect(
      audience("@builder @builder @critic", critic, [
        { agentId: "agent-builder" },
        { agentId: "agent-builder" },
        { agentId: "agent-critic" },
      ]),
    ).toEqual({ members: [members[1]], invitations: [] });
  });
});
