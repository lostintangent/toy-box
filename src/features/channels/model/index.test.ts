import { describe, expect, test } from "bun:test";
import type { ChannelAgent, ChannelMember, ChannelTask } from "./index";
import {
  agentHandleFromName,
  channelAudienceLabel,
  channelLead,
  channelRoutineInputSchema,
  channelSystemMessageContentSchema,
  channelTasksComplete,
  editChannelInputSchema,
  markChannelReadInputSchema,
  postChannelMessageInputSchema,
  resolveChannelAudience,
  selfUpdateChannelMemberInputSchema,
  setChannelAgentStatusInputSchema,
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
  test.each<{ acknowledgedRequest: boolean; expected: ChannelAgent[] }>([
    { acknowledgedRequest: true, expected: [lead, members[1]!] },
    { acknowledgedRequest: false, expected: [members[1]!] },
  ])(
    "request acknowledgement wakes the lead alongside mentions ($acknowledgedRequest)",
    ({ acknowledgedRequest, expected }) => {
      expect(
        resolveChannelAudience({
          content: "@builder use blue",
          sender: user,
          lead,
          members,
          acknowledgedRequest,
        }),
      ).toEqual(expected);
    },
  );
});

describe("channel audience labels", () => {
  test("names each agent a message reaches", () => {
    expect(channelAudienceLabel([members[0]!, members[1]!], 3)).toBe("Critic, Builder");
  });

  test("reaching every agent the sender could reads as Everyone", () => {
    expect(channelAudienceLabel([lead, members[0]!, members[1]!], 3)).toBe("Everyone");
    expect(channelAudienceLabel([members[0]!, members[1]!], 2)).toBe("Everyone");
  });

  test("a lone recipient is named, even when it's the only one reachable", () => {
    expect(channelAudienceLabel([lead], 1)).toBe("Lead");
  });
});

test("a task list is complete only when it has tasks and every subtask is done", () => {
  const release = (status: ChannelTask["status"]): ChannelTask => ({
    title: "Release",
    status: "done",
    children: [{ title: "Validate", status }],
  });
  expect(channelTasksComplete([])).toBe(false);
  expect(channelTasksComplete([{ title: "Review", status: "in_progress" }])).toBe(false);
  expect(channelTasksComplete([release("blocked")])).toBe(false);
  expect(channelTasksComplete([release("done"), { title: "Ship", status: "done" }])).toBe(true);
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
      selfUpdateChannelMemberInputSchema.safeParse({
        avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
      }).success,
    ).toBe(true);
    expect(
      selfUpdateChannelMemberInputSchema.safeParse({
        avatar: { mark: "<path />", color: "#7c3aed" },
      }).success,
    ).toBe(false);
  });
});

test("a working status points to at most one assigned message", () => {
  expect(
    setChannelAgentStatusInputSchema.safeParse({
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
  for (const previewUrl of ["/preview", "https://example.com", null]) {
    expect(
      channelSystemMessageContentSchema.safeParse({
        type: "preview_changed",
        actor: user,
        previewUrl,
      }).success,
    ).toBe(true);
  }
  expect(
    channelSystemMessageContentSchema.safeParse({
      type: "preview_changed",
      actor: user,
      previewUrl: "javascript:alert(1)",
    }).success,
  ).toBe(false);
});

test("lead edits allow clearing optional fields and require a change", () => {
  expect(updateChannelInputSchema.safeParse({ purpose: null, directory: null }).success).toBe(true);
  expect(updateChannelInputSchema.safeParse({}).success).toBe(false);
});

test("user messages require content or attachments and exclude agent-controlled fields", () => {
  const message = { id: "message", channelId: "channel", content: "Hello" };
  expect(postChannelMessageInputSchema.safeParse(message).success).toBe(true);
  expect(
    postChannelMessageInputSchema.safeParse({
      ...message,
      content: "",
      attachments: [{ mimeType: "image/png", base64: "AAEC" }],
    }).success,
  ).toBe(true);
  for (const change of [
    { content: "" },
    { content: "A".repeat(12_001) },
    { sender: { type: "agent", agentId: "lead" } },
  ]) {
    expect(postChannelMessageInputSchema.safeParse({ ...message, ...change }).success).toBe(false);
  }
});

test("read positions are nonnegative integer sequences", () => {
  for (const sequence of [0, 1]) {
    expect(markChannelReadInputSchema.safeParse({ channelId: "channel", sequence }).success).toBe(
      true,
    );
  }
  for (const sequence of [-1, 1.5]) {
    expect(markChannelReadInputSchema.safeParse({ channelId: "channel", sequence }).success).toBe(
      false,
    );
  }
});

test("property events carry exactly the value their field allows", () => {
  const actor = { type: "user" };
  expect(
    channelSystemMessageContentSchema.safeParse({
      type: "channel_purpose_changed",
      actor,
      purpose: null,
    }).success,
  ).toBe(true);
  expect(
    channelSystemMessageContentSchema.safeParse({ type: "channel_renamed", actor, name: null })
      .success,
  ).toBe(false);
  expect(
    channelSystemMessageContentSchema.safeParse({
      type: "channel_renamed",
      actor,
      name: "Plan",
      purpose: "Extra",
    }).success,
  ).toBe(false);
});

test("channel edits change only allowed properties", () => {
  expect(
    editChannelInputSchema.safeParse({
      channelId: "channel",
      name: "Planning",
      purpose: null,
      model: { provider: "copilot", name: "gpt-5.5" },
    }).success,
  ).toBe(true);
  expect(editChannelInputSchema.safeParse({ channelId: "channel" }).success).toBe(false);
  expect(
    editChannelInputSchema.safeParse({
      channelId: "channel",
      directory: "/different-project",
    }).success,
  ).toBe(false);
});

describe("channel routines", () => {
  test.each(["0 9 * * 1-5", "30 */2 * * *", "0 * * * *", "15 8 1 * *"])(
    "accepts %s because one fixed minute runs at most hourly",
    (schedule) => {
      expect(
        channelRoutineInputSchema.safeParse({ title: "CI", schedule, prompt: "Check CI" }).success,
      ).toBe(true);
    },
  );

  test.each(["*/15 * * * *", "0,30 9 * * *", "0-5 9 * * *", "@hourly", "0 0 9 * * *"])(
    "rejects %s",
    (schedule) => {
      expect(
        channelRoutineInputSchema.safeParse({ title: "CI", schedule, prompt: "Check CI" }).success,
      ).toBe(false);
    },
  );
});
