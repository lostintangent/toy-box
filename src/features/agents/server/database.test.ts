import { describe, expect, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";
import { AgentDatabase } from "./database";

async function openAgents(): Promise<AgentDatabase> {
  const database = await createTestDatabase();
  onTestFinished(() => database.close());
  return new AgentDatabase(database);
}

describe("Agent database", () => {
  test("persists one self-onboarded and evolving Agent identity", async () => {
    const agents = await openAgents();
    const first = await agents.createAgent({
      name: "Design Critic",
      persona: "A discerning product reviewer.",
    });
    expect(first).toMatchObject({
      name: "Design Critic",
      persona: "A discerning product reviewer.",
      experiences: [],
    });
    expect(first.avatar).toBeUndefined();
    const evolved = await agents.selfUpdateAgent(first.id, {
      persona: "A pragmatic critic who tests interaction assumptions with concrete examples.",
      avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
    });
    expect(evolved).toMatchObject({
      persona: "A pragmatic critic who tests interaction assumptions with concrete examples.",
      avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
    });

    await agents.updateAgent({
      agentId: first.id,
      model: { name: "gpt-5.4", reasoningEffort: "high" },
    });
    expect((await agents.getAgent(first.id))?.model).toEqual({
      name: "gpt-5.4",
      reasoningEffort: "high",
    });
    await agents.updateAgent({ agentId: first.id, model: null });
    expect((await agents.getAgent(first.id))?.model).toBeUndefined();
  });

  test("requires names to derive unique mention handles", async () => {
    const agents = await openAgents();
    const critic = await agents.createAgent({ name: "Design Critic" });
    const reviewer = await agents.createAgent({ name: "Reviewer" });

    await expect(agents.createAgent({ name: "Design-Critic" })).rejects.toThrow("@design-critic");
    await expect(
      agents.updateAgent({ agentId: reviewer.id, name: "design critic" }),
    ).rejects.toThrow("@design-critic");
    expect((await agents.getAgent(critic.id))?.name).toBe("Design Critic");
    expect((await agents.getAgent(reviewer.id))?.name).toBe("Reviewer");
  });

  test("keeps experiences explicit, reviewable, and individually editable", async () => {
    const agents = await openAgents();
    const agent = await agents.createAgent({ name: "Researcher" });
    const learned = await agents.manageExperience(agent.id, {
      action: "add",
      content: "The user prefers architectural claims backed by a concrete invariant.",
    });
    const experience = learned?.experiences[0]!;

    expect((await agents.getAgent(agent.id))?.experiences).toEqual([experience]);
    expect(
      await agents.manageExperience(agent.id, {
        action: "update",
        experienceId: experience.id,
        content: "The user prefers architectural claims grounded in a concrete invariant.",
      }),
    ).toMatchObject({
      experiences: [{ content: expect.stringContaining("grounded") }],
    });
    expect(
      await agents.manageExperience(agent.id, { action: "delete", experienceId: experience.id }),
    ).toMatchObject({ experiences: [] });
  });

  test("reuses one private membership per host and Agent", async () => {
    const agents = await openAgents();
    const agent = await agents.createAgent({ name: "Architect" });
    const host = { kind: "session" as const, sessionId: "host-session" };
    const membership = await agents.createMembership({
      host,
      agentId: agent.id,
      sessionId: "advisor-session",
      executionMode: "worktree",
    });

    expect(await agents.getMembership(host, agent.id)).toEqual(membership);
    expect(await agents.listAgentMembershipSessionIds(agent.id)).toEqual(["advisor-session"]);
    await expect(
      agents.createMembership({
        host,
        agentId: agent.id,
        sessionId: "another-session",
        executionMode: "shared",
      }),
    ).rejects.toThrow();
  });

  test("treats file memberships as resources owned by their source Session", async () => {
    const agents = await openAgents();
    const agent = await agents.createAgent({ name: "Editor" });
    const host = { kind: "file" as const, sessionId: "owner-session", path: "brief.md" };
    await agents.createMembership({
      host,
      agentId: agent.id,
      sessionId: "editor-session",
      executionMode: "shared",
    });
    expect(await agents.getMembership(host, agent.id)).toMatchObject({
      sessionId: "editor-session",
    });
    expect(await agents.listSessionOwnedMembershipSessionIds("owner-session")).toEqual([
      "editor-session",
    ]);
  });
});
