import { describe, expect, test } from "bun:test";
import type { ChannelMember } from "./index";
import {
  agentHandleFromName,
  findAgentMentionToken,
  resolveChannelAudience,
  selfUpdateAgentInputSchema,
  setChannelStatusInputSchema,
  splitAgentMentionText,
} from "./index";

const members: ChannelMember[] = [
  { channelId: "channel", id: "critic", name: "Critic" },
  { channelId: "channel", id: "builder", name: "Builder" },
];

const user = { type: "user" } as const;
const critic = { type: "agent", agentId: "critic" } as const;

function audience(content: string, sender: typeof user | typeof critic = user) {
  return resolveChannelAudience({ content, sender, members });
}

describe("channel delivery policy", () => {
  test("a user wakes everyone unless addressing specific agents", () => {
    expect(audience("Please review")).toEqual(members);
    expect(audience("@critic Please review")).toEqual([members[0]]);
    expect(audience("@everyone Please review")).toEqual(members);
    expect(audience("@critci Please review")).toEqual([]);
  });

  test("an agent only wakes addressed peers and never itself", () => {
    expect(audience("Here is my review", critic)).toEqual([]);
    expect(audience("@critic @builder please check", critic)).toEqual([members[1]]);
    expect(audience("@everyone please check", critic)).toEqual([members[1]]);
    expect(audience("@builder @builder", critic)).toEqual([members[1]]);
  });
});

describe("channel agent mentions", () => {
  test("derives safe handles and finds completion only at mention boundaries", () => {
    expect(agentHandleFromName("Design Critic")).toBe("design-critic");
    expect(agentHandleFromName("Everyone")).toBe("everyone-agent");
    expect(findAgentMentionToken("Ask (@Res", 9)).toEqual({ start: 5, end: 9, query: "res" });
    expect(findAgentMentionToken("mail dev@example", 16)).toBeUndefined();
  });

  test("splits visible mentions without treating email addresses as mentions", () => {
    expect(splitAgentMentionText("Ask @Critic, then dev@example.com.")).toEqual([
      { type: "text", content: "Ask " },
      { type: "mention", content: "@Critic", handle: "critic" },
      { type: "text", content: ", then dev@example.com." },
    ]);
  });

  test("accepts SVG path data for avatars but rejects markup", () => {
    expect(
      selfUpdateAgentInputSchema.safeParse({
        avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
      }).success,
    ).toBe(true);
    expect(
      selfUpdateAgentInputSchema.safeParse({
        avatar: { mark: "<path />", color: "#7c3aed" },
      }).success,
    ).toBe(false);
  });
});

test("a working status points to at most one assigned message", () => {
  expect(
    setChannelStatusInputSchema.safeParse({
      status: "Reviewing and implementing",
      lookingAt: 1,
      workingOn: 1,
    }).success,
  ).toBe(false);
});
