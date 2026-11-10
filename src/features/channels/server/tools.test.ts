import { expect, test } from "bun:test";
import { channelLeadTools, channelMemberTools, channelTools } from "./tools";

test("only leads receive nonterminal channel, task, routine, artifact, and member tools", () => {
  for (const name of [
    "update_channel",
    "edit_channel_tasks",
    "set_routine",
    "delete_routine",
    "remove_channel_artifact",
    "update_channel_member",
    "remove_channel_member",
    "message_channel_lead",
  ]) {
    const tool = channelLeadTools.find((tool) => tool.name === name);
    expect(tool).toBeDefined();
    expect(tool?.isTerminal).not.toBe(true);
    expect([...channelMemberTools, ...channelTools].some((tool) => tool.name === name)).toBe(false);
  }
});

test("only the lead's messages can request input", () => {
  const sendLead = channelLeadTools.find(({ name }) => name === "send_channel_message");
  const sendMember = channelMemberTools.find(({ name }) => name === "send_channel_message");
  const flagged = { content: "Which color?", request: true };

  expect(sendLead?.parameters?.parse(flagged)).toEqual(flagged);
  expect(sendMember?.parameters?.parse(flagged)).toEqual({ content: "Which color?" });
});

test("suggested replies parse only with a lead request", () => {
  const sendLead = channelLeadTools.find(({ name }) => name === "send_channel_message");
  const parameters = sendLead?.parameters;
  const replies = ["Yes", "Not yet"];

  expect(parameters?.parse({ content: "Ship it?", request: true, replies })).toEqual({
    content: "Ship it?",
    request: true,
    replies,
  });
  expect(parameters?.safeParse({ content: "Ship it?", replies }).success).toBe(false);
});

test.each(["lead", "member"] as const)(
  "%s agents can finish idle, waiting, or waiting with a bounded follow-up",
  (role) => {
    const tools = role === "lead" ? channelLeadTools : channelMemberTools;
    const finish = tools.find(({ name }) => name === "finish_agent_turn");
    const parameters = finish?.parameters;
    expect(parameters).toBeDefined();

    for (const input of [
      {},
      { waitingFor: "CI to finish" },
      ...[5, 20, 120].map((wakeAfterMinutes) => ({
        waitingFor: "CI to finish",
        wakeAfterMinutes,
      })),
    ]) {
      expect(parameters?.parse(input)).toEqual(input);
    }

    for (const input of [
      { wakeAfterMinutes: 20 },
      { waitingFor: " " },
      { waitingFor: " ", wakeAfterMinutes: 20 },
      { waitingFor: "CI to finish", extra: true },
      ...[4, 121, 5.5].map((wakeAfterMinutes) => ({
        waitingFor: "CI to finish",
        wakeAfterMinutes,
      })),
    ]) {
      expect(parameters?.safeParse(input).success).toBe(false);
    }
  },
);
