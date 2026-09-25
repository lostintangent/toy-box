import { describe, expect, test } from "bun:test";
import type { ChannelMember } from "./index";
import {
  agentHandleFromName,
  channelLead,
  resolveChannelAudience,
  selfUpdateAgentInputSchema,
  setChannelStatusInputSchema,
  splitAgentMentionText,
  updateChannelInputSchema,
} from "./index";

const members: ChannelMember[] = [
  { channelId: "channel", id: "critic", name: "Critic" },
  { channelId: "channel", id: "builder", name: "Builder" },
];
const lead = channelLead("lead");

const user = { type: "user" } as const;
const critic = { type: "agent", agentId: "critic" } as const;
const leadSender = { type: "agent", agentId: lead.id } as const;

function audience(content: string, sender: typeof user | typeof critic | typeof leadSender = user) {
  return resolveChannelAudience({ content, sender, lead, members });
}

describe("channel delivery policy", () => {
  test("unmentioned messages route to the intrinsic lead", () => {
    expect(audience("Please review")).toEqual([lead]);
    expect(audience("Here is my review", critic)).toEqual([lead]);
    expect(audience("Here is the plan", leadSender)).toEqual([]);
  });

  test("mentions route to exact agents without waking the sender", () => {
    expect(audience("@critic Please review")).toEqual([members[0]]);
    expect(audience("@lead Please review")).toEqual([lead]);
    expect(audience("@everyone Please review")).toEqual([lead, ...members]);
    expect(audience("@critci Please review")).toEqual([]);
    expect(audience("@critic @builder please check", critic)).toEqual([members[1]]);
    expect(audience("@everyone please check", critic)).toEqual([lead, members[1]]);
    expect(audience("@builder @builder", critic)).toEqual([members[1]]);
  });
});

describe("channel agent mentions", () => {
  test("derives safe handles", () => {
    expect(agentHandleFromName("Design Critic")).toBe("design-critic");
    expect(agentHandleFromName("Everyone")).toBe("everyone-agent");
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

test("channel previews accept only HTTP and root-relative URLs", () => {
  expect(updateChannelInputSchema.safeParse({ previewUrl: "http://127.0.0.1:3000" }).success).toBe(
    true,
  );
  expect(updateChannelInputSchema.safeParse({ previewUrl: "/?files=%5B%5D" }).success).toBe(true);
  expect(updateChannelInputSchema.safeParse({ previewUrl: "javascript:alert(1)" }).success).toBe(
    false,
  );
  expect(updateChannelInputSchema.safeParse({ previewUrl: "//example.com" }).success).toBe(false);
});
