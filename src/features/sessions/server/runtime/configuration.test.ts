import { describe, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import type { CopilotSession } from "@github/copilot-sdk";
import { AgentDatabase } from "@agents/server/database";
import * as state from "@/server/database";
import * as sdk from "../sdk/client";
import * as registry from "../state/registry";
import * as snapshots from "../state/snapshots";
import { createSession, deliverSessionMessage, SessionStream } from "./index";

async function setup(agentSession: boolean) {
  const sessionId = `configuration-${crypto.randomUUID()}`;
  const db = await state.createTestDatabase();
  spyOn(state, "getStateDatabase").mockResolvedValue(db);
  spyOn(sdk, "getSessionDirectory").mockResolvedValue(undefined);
  spyOn(snapshots, "loadSessionSnapshot").mockImplementation(async (id) => ({
    id,
    messages: [],
    queuedMessages: [],
    status: "idle",
    reasoningContent: "",
  }));
  const handles: ReturnType<typeof makeSession>[] = [];
  const create = spyOn(sdk, "createSession").mockImplementation(async () => {
    const handle = makeSession();
    handles.push(handle);
    return handle.session;
  });
  const resume = spyOn(sdk, "resumeSession").mockImplementation(async () => {
    const handle = makeSession();
    handles.push(handle);
    return handle.session;
  });
  const agents = new AgentDatabase(db);
  const createdAgent = await agents.createAgent({ name: "Critic" });
  const agent = (await agents.updateAgent({
    agentId: createdAgent.id,
    persona: "Original persona",
    model: { name: "model-one" },
  }))!;
  if (agentSession)
    await agents.createMembership({
      host: { kind: "session", sessionId: "parent" },
      agentId: agent.id,
      sessionId,
      executionMode: "shared",
    });
  onTestFinished(() => {
    SessionStream.remove(sessionId);
    registry.evictCachedSessionIfStale(sessionId, new Error("Session not found"));
    mock.restore();
    return db.close();
  });
  return { sessionId, agents, agent, create, resume, handles };
}

function makeSession() {
  const send = mock(async () => crypto.randomUUID());
  const disconnect = mock(async () => {});
  const session = {
    on: () => () => {},
    send,
    disconnect,
    rpc: { name: { set: async () => {} } },
  } as unknown as CopilotSession;
  return { session, send, disconnect };
}

describe("Session-owned configuration lifetime", () => {
  test("Agents refresh only between executions, including direct system messages", async () => {
    const { sessionId, agent, agents, create, resume, handles } = await setup(true);
    const receipt = await createSession(
      sessionId,
      {
        systemMessage: { type: "channel_message", senderName: "You" },
      },
      { sessionType: "agent" },
    );
    expect(create).toHaveBeenCalledTimes(1);
    const initialConfiguration = create.mock.calls[0]![1];
    expect(String(initialConfiguration.additionalInstructions)).not.toContain(
      "discover other sessions",
    );
    expect(initialConfiguration).toMatchObject({
      additionalInstructions: expect.stringContaining("Original persona"),
      model: { name: "model-one" },
    });
    expect(agent.avatar).toBeUndefined();

    await agents.selfUpdateAgent(agent.id, {
      persona: "Evolved persona",
      avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
    });
    await agents.manageExperience(agent.id, { action: "add", content: "Prefer evidence." });
    await agents.updateAgent({ agentId: agent.id, model: { name: "model-two" } });
    await deliverSessionMessage(sessionId, { content: "Continue" }, { immediate: true });
    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    // Ordinary Session completion needs neither an Agent acknowledgment nor an avatar.
    SessionStream.get(sessionId)!.finish();
    expect(await receipt.waitForCompletion()).toMatchObject({ status: "completed" });
    await Promise.all([
      deliverSessionMessage(sessionId, {
        systemMessage: {
          type: "file_edited",
          file: { kind: "session", sessionId, path: "report.md" },
        },
      }),
      deliverSessionMessage(sessionId, { content: "Follow up" }, { immediate: true }),
    ]);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
    const configuration = resume.mock.calls[0]![1];
    expect(configuration).toMatchObject({
      model: { name: "model-two" },
      disableMemory: true,
    });
    expect(configuration.additionalInstructions).toContain("Evolved persona");
    expect(configuration.additionalInstructions).toContain("#7c3aed self-authored mark");
    expect(configuration.additionalInstructions).toContain("Prefer evidence.");
    expect(handles[1]!.send).toHaveBeenCalledTimes(2);
  });

  test("ordinary Sessions retain their cached SDK handles between executions", async () => {
    const { sessionId, resume, handles } = await setup(false);
    await registry.getSession(sessionId);
    await deliverSessionMessage(sessionId, { content: "First" });
    SessionStream.get(sessionId)!.finish();
    await deliverSessionMessage(sessionId, { content: "Second" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();
    expect(handles[0]!.send).toHaveBeenCalledTimes(2);
  });
});
