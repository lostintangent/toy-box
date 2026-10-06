import { expect, test } from "bun:test";
import { channelLeadTools, channelMemberTools, channelTools } from "./tools";

test("only leads receive nonterminal routine tools", () => {
  for (const name of ["set_routine", "delete_routine"]) {
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

test("only the lead can ask to be woken, and within two hours", () => {
  const finishLead = channelLeadTools.find(({ name }) => name === "finish_agent_turn");
  const finishMember = channelMemberTools.find(({ name }) => name === "finish_agent_turn");
  const followUp = { waitingFor: "CI to finish", wakeAfterMinutes: 20 };

  expect(finishLead?.parameters?.safeParse(followUp).success).toBe(true);
  expect(finishLead?.parameters?.safeParse({ ...followUp, wakeAfterMinutes: 121 }).success).toBe(
    false,
  );
  expect(finishMember?.parameters?.safeParse(followUp).success).toBe(false);
});
