import { describe, expect, test } from "bun:test";
import { withoutLeadingMentions } from "./agent";

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
