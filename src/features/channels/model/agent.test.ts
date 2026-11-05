import { describe, expect, test } from "bun:test";
import {
  channelAgentIdentity,
  DELETED_AGENT_NAME,
  resolveChannelAgentId,
  withoutLeadingMentions,
} from "./agent";

const agents = [{ name: "Lead" }, { name: "Interface" }, { name: "Engine" }];

describe("without leading mentions", () => {
  test("drops the agents a message opens by addressing", () => {
    expect(withoutLeadingMentions("@lead @Interface The lift is ready.", agents)).toBe(
      "The lift is ready.",
    );
    expect(withoutLeadingMentions("@lead, can you check?\n\nThanks", agents)).toBe(
      "can you check?\n\nThanks",
    );
    expect(withoutLeadingMentions("@everyone Standup in five.", agents)).toBe("Standup in five.");
  });

  test("leaves text that doesn't open with a mention alone", () => {
    expect(withoutLeadingMentions("Ready for @lead", agents)).toBe("Ready for @lead");
    expect(withoutLeadingMentions("@lead's plan works", agents)).toBe("@lead's plan works");
  });

  test("keeps mentions that name no agent, or that are the whole message", () => {
    expect(withoutLeadingMentions("@engien fix the lift", agents)).toBe("@engien fix the lift");
    expect(withoutLeadingMentions("@engine", agents)).toBe("@engine");
  });
});

describe("agent identity", () => {
  const team = [
    { id: "lead", name: "Lead" },
    { id: "engine", name: "Engine" },
  ];

  test("resolves a current agent to itself", () => {
    expect(channelAgentIdentity(team, "engine")).toBe(team[1]!);
  });

  test("resolves a removed agent to a deleted identity that keeps its ID", () => {
    expect(channelAgentIdentity(team, "critic")).toEqual({
      id: "critic",
      name: DELETED_AGENT_NAME,
      deleted: true,
    });
  });
});

describe("agent references", () => {
  const team = [
    { id: "lead-id", name: "Lead" },
    { id: "designer-id", name: "Product Designer" },
  ];

  test("resolves an agent ID or mention to the agent's ID", () => {
    for (const reference of ["designer-id", "@product-designer", "Product-Designer"]) {
      expect(resolveChannelAgentId(team, reference)).toBe("designer-id");
    }
    expect(resolveChannelAgentId(team, "@lead")).toBe("lead-id");
  });

  test("resolves nothing for an agent outside the team", () => {
    expect(resolveChannelAgentId(team, "@critic")).toBeUndefined();
    expect(resolveChannelAgentId(team.slice(1), "@lead")).toBeUndefined();
  });
});
