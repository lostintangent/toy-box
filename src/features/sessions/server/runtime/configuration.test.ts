import { describe, expect, jest, mock, onTestFinished, spyOn, test } from "bun:test";
import type { SessionConnection } from "@providers/server/provider";
import { AgentDatabase } from "@agents/server/database";
import * as state from "@/server/database";
import * as sdk from "../providers";
import * as registry from "../state/registry";
import * as snapshots from "../state/snapshots";
import { bindProviderSession } from "../state/sessions";
import { getSessionConfiguration } from "@/server/sessionTools";
import * as settings from "@workspace/server/state/settings";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
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
    model: { provider: "copilot", name: "model-one" },
  }))!;
  if (agentSession)
    await agents.createMembership({
      host: { kind: "session", sessionId: "parent" },
      agentId: agent.id,
      sessionId,
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
    identity: { sessionId: "test", providerId: "copilot", nativeId: "test" },
    onEvent: () => () => {},
    setModel: async () => {},
    rename: async () => true,
    send,
    disconnect,
    rpc: { name: { set: async () => {} } },
  } as unknown as SessionConnection;
  return { session, send, disconnect };
}

describe("Session-owned configuration lifetime", () => {
  test.each(["copilot", "codex"] as const)(
    "inherited Agent models preserve an existing %s provider when the workspace default changes",
    async (providerId) => {
      const { sessionId, agent, agents } = await setup(true);
      await agents.updateAgent({ agentId: agent.id, model: null });
      const defaultModel = {
        provider: providerId === "copilot" ? "codex" : "copilot",
        name: "new-default",
      };
      spyOn(settings, "getSettings").mockResolvedValue({ ...DEFAULT_SETTINGS, defaultModel });
      expect(await getSessionConfiguration(sessionId, "agent")).toMatchObject({
        model: defaultModel,
      });

      await bindProviderSession({ sessionId, providerId, nativeId: "existing-native-session" });
      expect(await getSessionConfiguration(sessionId, "agent")).not.toHaveProperty("model");

      const sameProviderDefault = { provider: providerId, name: "updated-model" };
      spyOn(settings, "getSettings").mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultModel: sameProviderDefault,
      });
      expect(await getSessionConfiguration(sessionId, "agent")).toMatchObject({
        model: sameProviderDefault,
      });
    },
  );

  test("Agents refresh changed configuration only between executions", async () => {
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
      model: { provider: "copilot", name: "model-one" },
    });
    expect(agent.avatar).toBeUndefined();

    await agents.selfUpdateAgent(agent.id, {
      persona: "Evolved persona",
      avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
    });
    await agents.manageExperience(agent.id, {
      action: "add",
      content: "Prefer evidence.",
    });
    await agents.updateAgent({
      agentId: agent.id,
      model: { provider: "copilot", name: "model-two" },
    });
    await deliverSessionMessage(sessionId, { content: "Continue" }, { immediate: true });
    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    // Ordinary Session completion needs neither an Agent acknowledgment nor an avatar.
    SessionStream.get(sessionId)!.finish();
    expect(await receipt.waitForCompletion()).toMatchObject({
      status: "completed",
    });
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
      model: { provider: "copilot", name: "model-two" },
      disableMemory: true,
    });
    expect(configuration.additionalInstructions).toContain("Evolved persona");
    expect(configuration.additionalInstructions).toContain("#7c3aed self-authored mark");
    expect(configuration.additionalInstructions).toContain("Prefer evidence.");
    expect(handles[1]!.send).toHaveBeenCalledTimes(2);

    SessionStream.get(sessionId)!.finish();
    await deliverSessionMessage(sessionId, { content: "One more" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[1]!.disconnect).not.toHaveBeenCalled();
    expect(handles[1]!.send).toHaveBeenCalledTimes(3);
  });

  test("bounded SDK operations do not refresh changed Agent configuration", async () => {
    const { sessionId, agent, agents, resume, handles } = await setup(true);
    await createSession(sessionId, { content: "Start" }, { sessionType: "agent" });
    SessionStream.get(sessionId)!.finish();
    await agents.updateAgent({ agentId: agent.id, persona: "Changed persona" });

    await registry.withSession(sessionId, (session) => session.rename("Renamed"));

    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    await deliverSessionMessage(sessionId, { content: "Continue" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  test("ordinary Sessions retain their cached SDK sessions between executions", async () => {
    const { sessionId, resume, handles } = await setup(false);
    await deliverSessionMessage(sessionId, { content: "First" });
    SessionStream.get(sessionId)!.finish();
    await deliverSessionMessage(sessionId, { content: "Second" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();
    expect(handles[0]!.send).toHaveBeenCalledTimes(2);
  });

  test("disconnects after the idle window and waits for detach before resuming", async () => {
    const { sessionId, resume, handles } = await setup(false);

    jest.useFakeTimers();
    let finishDisconnect!: () => void;
    try {
      await deliverSessionMessage(sessionId, { content: "First" });
      handles[0]!.disconnect.mockImplementation(
        () => new Promise<void>((resolve) => (finishDisconnect = resolve)),
      );
      jest.advanceTimersByTime(30 * 60 * 1000);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      SessionStream.get(sessionId)!.finish();
      jest.advanceTimersByTime(30 * 60 * 1000 - 1);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }

    const nextExecution = deliverSessionMessage(sessionId, { content: "Second" });
    await Promise.resolve();
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
    finishDisconnect();
    await nextExecution;
    expect(resume).toHaveBeenCalledTimes(2);
    expect(handles[1]!.send).toHaveBeenCalledTimes(1);
  });

  test("retains a cached SDK session when idle disconnect fails", async () => {
    const { sessionId, resume, handles } = await setup(false);

    await deliverSessionMessage(sessionId, { content: "First" });
    SessionStream.get(sessionId)!.finish();
    handles[0]!.disconnect.mockImplementation(async () => {
      throw new Error("Detach failed");
    });

    await expect(registry.releaseIdleSession(sessionId)).rejects.toThrow("Detach failed");
    await deliverSessionMessage(sessionId, { content: "Second" });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.send).toHaveBeenCalledTimes(2);
  });

  test("short SDK operations restart idle session retention", async () => {
    const { sessionId, handles } = await setup(false);

    jest.useFakeTimers();
    try {
      await deliverSessionMessage(sessionId, { content: "First" });
      SessionStream.get(sessionId)!.finish();
      jest.advanceTimersByTime(29 * 60 * 1000);

      let finishOperation!: () => void;
      const operation = registry.withSession(
        sessionId,
        () => new Promise<void>((resolve) => (finishOperation = resolve)),
      );
      await Promise.resolve();
      jest.advanceTimersByTime(2 * 60 * 1000);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      finishOperation();
      await operation;
      jest.advanceTimersByTime(29 * 60 * 1000);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(60 * 1000);
      expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("supervisors release completed SDK sessions without interrupting execution", async () => {
    const { sessionId, resume, handles } = await setup(false);

    await deliverSessionMessage(sessionId, { content: "First" });
    await registry.releaseIdleSession(sessionId);
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    SessionStream.get(sessionId)!.finish();
    await registry.releaseIdleSession(sessionId);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);

    await deliverSessionMessage(sessionId, { content: "Second" });
    expect(resume).toHaveBeenCalledTimes(2);
    expect(handles[1]!.send).toHaveBeenCalledTimes(1);
  });
});
