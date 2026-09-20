import { describe, expect, jest, mock, onTestFinished, spyOn, test } from "bun:test";
import type { SessionConnection } from "@providers/server/provider";
import type { ChannelAgentMetadata } from "@channels/model";
import { ChannelDatabase } from "@channels/server/database";
import { WorkerDatabase } from "@workers/server/database";
import { smallJsonSchema } from "@/shared/smallJson";
import * as state from "@/server/database";
import * as sdk from "../providers";
import * as registry from "../state/registry";
import * as snapshots from "../state/snapshots";
import { setSessionProvider } from "../state/sessions";
import { getSessionConfiguration } from "@/server/sessionConfiguration";
import * as settings from "@workspace/server/state/settings";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import { createSession, deliverSessionMessage } from "./index";
import { SessionStream } from "./sessionStream";
import { createInitialSessionState } from "@sessions/model/reducer";

async function setup(channelWorker: boolean) {
  const sessionId = `configuration-${crypto.randomUUID()}`;
  const db = await state.createTestDatabase();
  spyOn(state, "getStateDatabase").mockResolvedValue(db);
  spyOn(sdk, "getSessionDirectory").mockResolvedValue(undefined);
  spyOn(snapshots, "loadSessionSnapshot").mockImplementation(async () =>
    createInitialSessionState(),
  );
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
  const channels = new ChannelDatabase(db);
  if (channelWorker) {
    const channel = await channels.createChannel({ title: "Configuration" });
    await channels.createMember({
      type: "channel",
      channelId: channel.id,
      sessionId,
      ephemeral: false,
      name: "Critic",
      metadata: {
        seenThrough: 0,
        role: "Original role",
        model: { provider: "copilot", name: "model-one" },
      },
    });
  }
  onTestFinished(() => {
    SessionStream.remove(sessionId);
    registry.evictCachedSessionIfStale(sessionId, new Error("Session not found"));
    mock.restore();
    return db.close();
  });
  return { sessionId, db, create, resume, handles };
}

async function setChannelAgentMetadata(
  database: Bun.SQL,
  sessionId: string,
  metadata: ChannelAgentMetadata,
): Promise<void> {
  const workers = new WorkerDatabase(database);
  const worker = await workers.get(sessionId);
  if (worker?.type !== "channel") throw new Error("Channel Worker not found.");
  await workers.update(sessionId, { name: worker.name, metadata: smallJsonSchema.parse(metadata) });
}

function makeSession() {
  const send = mock(async () => crypto.randomUUID());
  const disconnect = mock(async () => {});
  const session = {
    provider: { id: "copilot", sessionId: "test" },
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
  test("assigns role-specific tools to each Session type", async () => {
    const { sessionId, db } = await setup(false);
    const workerSessionId = `${sessionId}-worker`;
    await new WorkerDatabase(db).create({
      type: "app",
      appId: "app-a",
      sessionId: workerSessionId,
      ephemeral: true,
    });
    const toolsFor = async (
      sessionType: "standard" | "hyper" | "automation" | "inbox" | "worker",
    ) =>
      (
        await getSessionConfiguration(
          sessionType === "worker" ? workerSessionId : sessionId,
          sessionType,
        )
      ).tools.map((tool) => tool.name);

    const standard = await toolsFor("standard");
    expect(standard).toEqual(
      expect.arrayContaining([
        "update_session_title",
        "open_session",
        "open_file",
        "list_models",
        "list_channels",
        "create_channel_members",
      ]),
    );
    expect(standard).not.toContain("create_session");
    expect(standard).not.toContain("update_settings");

    const hyper = await toolsFor("hyper");
    expect(hyper).toEqual(
      expect.arrayContaining([
        "create_session",
        "open_session",
        "open_file",
        "register_editor",
        "update_settings",
        "list_models",
        "list_channels",
        "create_channel_members",
      ]),
    );
    expect(hyper).not.toContain("update_session_title");

    const automation = await toolsFor("automation");
    expect(automation).toEqual(
      expect.arrayContaining(["list_models", "list_channels", "update_settings"]),
    );
    expect(automation).not.toContain("create_channel_members");
    expect(automation).not.toContain("open_file");

    const inbox = await toolsFor("inbox");
    expect(inbox).toEqual(
      expect.arrayContaining([
        "list_models",
        "list_channels",
        "create_channel_members",
        "send_to_inbox",
      ]),
    );
    expect(inbox).not.toContain("update_settings");

    const worker = await toolsFor("worker");
    expect(worker).not.toContain("list_channels");
    expect(worker).toContain("list_models");
    expect(worker).not.toContain("create_channel_members");
    expect(worker).not.toContain("open_file");
  });

  test.each(["copilot", "codex"] as const)(
    "inherited Channel agent models preserve an existing %s provider when the workspace default changes",
    async (providerId) => {
      const { sessionId, db } = await setup(true);
      await setChannelAgentMetadata(db, sessionId, {
        seenThrough: 0,
        role: "Original role",
      });
      const defaultModel = {
        provider: providerId === "copilot" ? "codex" : "copilot",
        name: "new-default",
      };
      spyOn(settings, "getSettings").mockResolvedValue({ ...DEFAULT_SETTINGS, defaultModel });
      expect(await getSessionConfiguration(sessionId, "worker")).toMatchObject({
        model: defaultModel,
      });

      await setSessionProvider(sessionId, { id: providerId, sessionId: "existing-native-session" });
      expect(await getSessionConfiguration(sessionId, "worker")).not.toHaveProperty("model");

      const sameProviderDefault = { provider: providerId, name: "updated-model" };
      spyOn(settings, "getSettings").mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultModel: sameProviderDefault,
      });
      expect(await getSessionConfiguration(sessionId, "worker")).toMatchObject({
        model: sameProviderDefault,
      });
    },
  );

  test("Channel agents refresh changed configuration only between executions", async () => {
    const { sessionId, db, create, resume, handles } = await setup(true);
    const receipt = await createSession(
      sessionId,
      {
        systemMessage: { type: "channel_message", senderName: "You" },
      },
      { sessionType: "worker" },
    );
    expect(create).toHaveBeenCalledTimes(1);
    const initialConfiguration = create.mock.calls[0]![1];
    expect(String(initialConfiguration.additionalInstructions)).not.toContain(
      "discover other sessions",
    );
    expect(initialConfiguration).toMatchObject({
      additionalInstructions: expect.stringContaining("Original role"),
      model: { provider: "copilot", name: "model-one" },
    });
    const initialToolNames = initialConfiguration.tools?.map((tool) => tool.name) ?? [];
    expect(initialToolNames).toEqual(
      expect.arrayContaining([
        "read_channel",
        "list_models",
        "create_channel_members",
        "set_channel_status",
        "finish_agent_turn",
        "update_agent",
      ]),
    );
    expect(initialToolNames).not.toContain("list_sessions");
    await setChannelAgentMetadata(db, sessionId, {
      seenThrough: 0,
      role: "Evolved role",
      avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
      model: { provider: "copilot", name: "model-two" },
    });
    await deliverSessionMessage(sessionId, { content: "Continue", immediate: true });
    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

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
      deliverSessionMessage(sessionId, { content: "Follow up", immediate: true }),
    ]);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
    const configuration = resume.mock.calls[0]![1];
    expect(configuration).toMatchObject({
      model: { provider: "copilot", name: "model-two" },
      disableMemory: true,
    });
    expect(configuration.additionalInstructions).toContain("Evolved role");
    expect(configuration.additionalInstructions).toContain("#7c3aed self-authored mark");
    expect(handles[1]!.send).toHaveBeenCalledTimes(2);

    SessionStream.get(sessionId)!.finish();
    await deliverSessionMessage(sessionId, { content: "One more" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[1]!.disconnect).not.toHaveBeenCalled();
    expect(handles[1]!.send).toHaveBeenCalledTimes(3);
  });

  test("bounded SDK operations do not refresh changed Channel agent configuration", async () => {
    const { sessionId, db, resume, handles } = await setup(true);
    await createSession(sessionId, { content: "Start" }, { sessionType: "worker" });
    SessionStream.get(sessionId)!.finish();
    await setChannelAgentMetadata(db, sessionId, {
      seenThrough: 0,
      role: "Changed role",
      model: { provider: "copilot", name: "model-one" },
    });

    await registry.withSession(sessionId, (session) => session.rename("Renamed"));

    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    await deliverSessionMessage(sessionId, { content: "Continue" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  test("automatic titles publish only accepted changes without a native event echo", async () => {
    const { sessionId, handles } = await setup(false);
    await deliverSessionMessage(sessionId, { content: "First" });
    const rename = spyOn(handles[0]!.session, "rename")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const titles: string[] = [];
    onTestFinished(
      subscribeWorkspaceEvents((event) => {
        if (event.type === "session.upserted" && event.session.id === sessionId)
          titles.push(event.session.title!);
      }),
    );

    expect(await registry.updateSessionTitle(sessionId, "New focus")).toBe(true);
    expect(await registry.updateSessionTitle(sessionId, "Preserve the owner's title")).toBe(false);
    expect(rename).toHaveBeenCalledWith("New focus", true);
    expect(titles).toEqual(["New focus"]);
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

  test("deletion waits for the native connection's final history flush", async () => {
    const { sessionId, handles } = await setup(false);
    await deliverSessionMessage(sessionId, { content: "First" });
    let history: string | undefined = "Transcript";
    const disconnecting = Promise.withResolvers<void>();
    const disconnected = Promise.withResolvers<void>();
    handles[0]!.disconnect.mockImplementation(async () => {
      disconnecting.resolve();
      await disconnected.promise;
      history = "Final native flush";
    });
    spyOn(sdk, "deleteSession").mockImplementation(async () => {
      history = undefined;
    });

    const deletion = registry.deleteSession(sessionId);
    await disconnecting.promise;
    expect(SessionStream.get(sessionId)).toBeUndefined();
    expect(history).toBe("Transcript");
    disconnected.resolve();
    await deletion;
    expect(history).toBeUndefined();
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
