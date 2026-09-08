import { describe, expect, test } from "bun:test";
import {
  agentHandleFromName,
  createAgentInputSchema,
  findAgentMentionToken,
  manageAgentExperienceInputSchema,
  manageAgentExperienceRequestSchema,
  selfUpdateAgentInputSchema,
  splitAgentMentionText,
} from ".";

describe("agent mentions", () => {
  test("derives mention handles from names and reserves @everyone for channels", () => {
    expect(agentHandleFromName("Design Critic")).toBe("design-critic");
    expect(agentHandleFromName("Everyone")).toBe("everyone-agent");
  });

  test("creates a named identity with an optional persona before mention onboarding", () => {
    expect(createAgentInputSchema.safeParse({ name: "Research Lead" }).success).toBe(true);
    expect(
      createAgentInputSchema.safeParse({ name: "Research Lead", persona: "Preconfigured" }).success,
    ).toBe(true);
    expect(
      createAgentInputSchema.safeParse({
        name: "Research Lead",
        avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
      }).success,
    ).toBe(false);
  });

  test("finds mention completion at punctuation boundaries and the active caret", () => {
    expect(findAgentMentionToken("Ask (@Res", 9)).toEqual({
      start: 5,
      end: 9,
      query: "res",
    });
    expect(findAgentMentionToken("mail dev@example", 16)).toBeUndefined();
    expect(findAgentMentionToken("@critic later", 13)).toBeUndefined();
  });

  test("splits mentions for display without treating email addresses as mentions", () => {
    expect(splitAgentMentionText("Ask @Critic, then dev@example.com and @planner.")).toEqual([
      { type: "text", content: "Ask " },
      { type: "mention", content: "@Critic", handle: "critic" },
      { type: "text", content: ", then dev@example.com and " },
      { type: "mention", content: "@planner", handle: "planner" },
      { type: "text", content: "." },
    ]);
  });

  test("keeps scalar self-updates separate from individual experience changes", () => {
    expect(selfUpdateAgentInputSchema.safeParse({ persona: "A sharper reviewer." }).success).toBe(
      true,
    );
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
    expect(selfUpdateAgentInputSchema.safeParse({}).success).toBe(false);
    for (const change of [
      { action: "add", content: "Prefer direct evidence." },
      { action: "update", experienceId: "experience", content: "Prefer primary evidence." },
      { action: "delete", experienceId: "experience" },
    ]) {
      expect(manageAgentExperienceInputSchema.safeParse(change).success).toBe(true);
    }
    expect(manageAgentExperienceInputSchema.safeParse({ action: "add" }).success).toBe(false);
    expect(
      manageAgentExperienceInputSchema.safeParse({ action: "update", experienceId: "experience" })
        .success,
    ).toBe(false);
    expect(
      manageAgentExperienceRequestSchema.safeParse({
        agentId: "agent",
        change: { action: "add", content: "Prefer direct evidence." },
      }).success,
    ).toBe(false);
    expect(
      manageAgentExperienceRequestSchema.safeParse({
        agentId: "agent",
        change: { action: "delete", experienceId: "experience" },
      }).success,
    ).toBe(true);
  });
});
