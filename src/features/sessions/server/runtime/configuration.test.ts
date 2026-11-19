import { createStoredChannel } from "@channels/server/testFixtures";
import { describe, expect, jest, mock, onTestFinished, spyOn, test } from "bun:test";
import {
  SessionConnectionUnavailableError,
  SessionNotFoundError,
  type SessionConnection,
} from "@providers/server/provider";
import { ChannelDatabase } from "@channels/server/database";
import { stopProviders } from "@providers/server";
import * as cli from "@providers/server/cli";
import { codexProvider } from "@providers/server/codex/provider";
import { copilotProvider } from "@providers/server/copilot/provider";
import { createAutomation } from "@automations/server";
import { WorkerDatabase } from "@workers/server/database";
import { openTestDatabase } from "@/server/testFixtures";
import * as sdk from "../providers";
import * as registry from "../state/registry";
import * as snapshots from "../state/snapshots";
import { insertSession, readSession, setSessionProvider } from "../state/sessions";
import { getSessionConfiguration } from "@/server/sessionConfiguration";
import * as settings from "@workspace/server/state/settings";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import {
  abortSession,
  createSession,
  deleteSession,
  deliverSessionMessage,
  getSessionSnapshot,
  isSessionRunning,
  recreateSession,
} from "./index";
import type { Session, SessionEvent, SessionMessage } from "@sessions/model";
import { createInitialSessionState } from "@sessions/model/reducer";
import { deleteSessionFiles } from "../artifacts";
import { deleteSessionActivity } from "@sessions/server/state/activity";

async function setup(agent?: "member" | "lead") {
  let sessionId = `configuration-${crypto.randomUUID()}`;
  const db = await openTestDatabase();
  onTestFinished(async () => {
    try {
      await abortSession(sessionId);
      registry.evictConnectionIfStale(sessionId, new SessionNotFoundError(sessionId));
      snapshots.evictCachedSnapshot(sessionId);
      deleteSessionActivity(sessionId);
      await deleteSessionFiles(sessionId);
    } finally {
      mock.restore();
    }
  });
  spyOn(snapshots, "loadSessionSnapshot").mockImplementation(async () =>
    createInitialSessionState(),
  );
  const handles: ReturnType<typeof makeSession>[] = [];
  const connect = async () => {
    const handle = makeSession();
    handles.push(handle);
    return handle.session;
  };
  const create = spyOn(sdk, "createSession").mockImplementation(async () => ({
    connection: await connect(),
    provider: { id: "copilot", sessionId: "test" },
  }));
  const resume = spyOn(sdk, "resumeSession").mockImplementation(connect);
  if (agent) {
    const channels = new ChannelDatabase(db);
    const channel = await createStoredChannel(channels, {
      name: "Configuration",
      purpose: "Verify channel agent configuration.",
      model: { provider: "copilot", name: "gpt-5.5" },
    });
    if (agent === "lead") {
      sessionId = channel.id;
    } else {
      await channels.createMember({
        createdAt: new Date(0).toISOString(),
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
  }
  return { sessionId, db, create, resume, handles };
}

function makeSession(nativeId = "test") {
  let listener: ((event: SessionEvent) => void) | undefined;
  const emit = (event: SessionEvent) => listener?.(event);
  // Providers echo each input, which moves it from the queue into the transcript.
  const send = mock(async (message: SessionMessage) =>
    emit(
      message.role === "user"
        ? { type: "user_message", content: message.content, clientId: message.clientId }
        : { type: "system_message", content: message.content, clientId: message.clientId },
    ),
  );
  const abort = mock(async () => {});
  const disconnect = mock(async () => {});
  const session: SessionConnection = {
    nativeId,
    onEvent: (next) => {
      listener = next;
      return () => {
        if (listener === next) listener = undefined;
      };
    },
    setModel: async () => {},
    answerQuestion: async () => false,
    abort,
    rename: async () => true,
    send,
    disconnect,
    rewind: async () => {},
  };
  const finish = () => emit({ type: "end", reason: "idle" });
  return { session, send, abort, disconnect, finish };
}

describe("Session recreation", () => {
  test("recreation can switch providers while retaining the public session ID", async () => {
    const { sessionId, create, resume } = await setup();
    const previousProvider = {
      id: "copilot",
      sessionId: "previous-native-id",
    };
    const previous = makeSession(previousProvider.sessionId);
    await insertSession({ id: sessionId, createdAt: new Date(0), artifactPath: "old.md" });
    await setSessionProvider(sessionId, previousProvider);
    resume.mockResolvedValueOnce(previous.session);
    await deliverSessionMessage(sessionId, { content: "Previous conversation" });
    previous.finish();

    const deletedProviders: Session["provider"][] = [];
    spyOn(sdk, "deleteSession").mockImplementation(async (id) => {
      expect(previous.disconnect).toHaveBeenCalledTimes(1);
      deletedProviders.push((await readSession(id))?.provider);
    });
    const replacementProvider = { id: "codex", sessionId: "replacement-native-id" };
    const replacement = makeSession(replacementProvider.sessionId);
    create.mockImplementationOnce(async (id) => ({
      connection: replacement.session,
      provider: await setSessionProvider(id, replacementProvider),
    }));

    const model = { provider: "codex", name: "new-model" };
    await recreateSession(
      sessionId,
      { clientId: "first-message", content: "Start fresh", model },
      { name: "Recreated session" },
    );

    expect(deletedProviders).toEqual([previousProvider]);
    const record = await readSession(sessionId);
    expect(record).toMatchObject({
      id: sessionId,
      provider: replacementProvider,
    });
    expect(record?.artifactPath).toBeUndefined();
    expect((await getSessionSnapshot(sessionId)).model).toEqual(model);
    expect(replacement.send).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "first-message", content: "Start fresh" }),
    );
  });

  test("recreation projects its draft before announcing a live runtime", async () => {
    const { sessionId, create } = await setup();
    let deletionPublished = false;
    const projected = Promise.withResolvers<void>();
    let running = false;
    onTestFinished(
      subscribeWorkspaceEvents((event) => {
        if (event.type === "session.deleted" && event.sessionId === sessionId)
          deletionPublished = true;
        if (event.type === "session.upserted" && event.session.id === sessionId)
          projected.resolve();
        if (event.type === "session.running" && event.sessionId === sessionId) running = true;
      }),
    );

    const providerCreation = Promise.withResolvers<void>();
    onTestFinished(() => providerCreation.resolve());
    create.mockImplementationOnce(async () => {
      await providerCreation.promise;
      return { connection: makeSession().session, provider: { id: "copilot" } };
    });

    const replacement = recreateSession(
      sessionId,
      { content: "Second", model: { provider: "copilot", name: "gpt-5" } },
      { name: "Daily summary" },
    );
    await projected.promise;
    expect(await readSession(sessionId)).toBeDefined();
    expect(deletionPublished).toBe(false);
    expect(running).toBe(false);

    providerCreation.resolve();
    await replacement;
    expect(running).toBe(true);
  });

  test("removes the replacement draft when its provider cannot be created", async () => {
    const { sessionId, create } = await setup();
    const events: string[] = [];
    onTestFinished(
      subscribeWorkspaceEvents((event) => {
        if (event.type === "session.upserted" && event.session.id === sessionId)
          events.push(event.type);
        if (event.type === "session.deleted" && event.sessionId === sessionId)
          events.push(event.type);
      }),
    );
    create.mockRejectedValueOnce(new Error("Provider unavailable"));

    await expect(recreateSession(sessionId, { content: "Start fresh" }, {})).rejects.toThrow(
      "Provider unavailable",
    );

    expect(await readSession(sessionId)).toBeUndefined();
    expect(isSessionRunning(sessionId)).toBe(false);
    expect(events).toEqual(["session.upserted", "session.deleted"]);
  });
});

describe("Session-owned configuration lifetime", () => {
  test("assigns role-specific tools to each Session type", async () => {
    const { sessionId, db } = await setup();
    const workerSessionId = `${sessionId}-worker`;
    await new WorkerDatabase(db).create({
      createdAt: new Date(0).toISOString(),
      type: "app",
      appId: "app-a",
      sessionId: workerSessionId,
      ephemeral: true,
    });
    const hyperSessionId = `${sessionId}-hyper`;
    await settings.saveSettings({ ...DEFAULT_SETTINGS, hyperSessionId });
    const { id: automationId } = await createAutomation({
      title: "Daily summary",
      prompt: "Summarize",
      model: { provider: "copilot", name: "gpt-5" },
      cron: "0 9 * * *",
    });
    const toolsFor = async (id: string) =>
      (await getSessionConfiguration(id)).tools.map((tool) => tool.name);

    const standard = await toolsFor(sessionId);
    expect(standard).toEqual(
      expect.arrayContaining([
        "update_session_title",
        "open_session",
        "open_file",
        "list_models",
        "list_channels",
        "create_channel_members",
        "list_screens",
      ]),
    );
    expect(standard).not.toContain("create_session");
    expect(standard).not.toContain("update_settings");

    const hyper = await toolsFor(hyperSessionId);
    expect(hyper).toEqual(
      expect.arrayContaining([
        "create_session",
        "open_session",
        "open_file",
        "update_settings",
        "list_models",
        "list_channels",
        "create_channel_members",
        "list_screens",
      ]),
    );
    expect(hyper).not.toContain("update_session_title");

    const automation = await toolsFor(automationId);
    expect(automation).toEqual(
      expect.arrayContaining(["list_models", "list_channels", "update_settings"]),
    );
    expect(automation).not.toContain("create_channel_members");
    expect(automation).not.toContain("open_file");
    expect(automation).not.toContain("list_screens");

    const inboxId = `${sessionId}-inbox`;
    await new WorkerDatabase(db).create({
      type: "inbox",
      sessionId: inboxId,
      createdAt: new Date(0).toISOString(),
      ephemeral: false,
    });
    const inbox = await toolsFor(inboxId);
    expect(inbox).toEqual(
      expect.arrayContaining([
        "list_models",
        "list_channels",
        "create_channel_members",
        "send_to_inbox",
      ]),
    );
    expect(inbox).not.toContain("update_settings");

    const worker = await toolsFor(workerSessionId);
    expect(worker).not.toContain("list_channels");
    expect(worker).toContain("list_models");
    expect(worker).not.toContain("create_channel_members");
    expect(worker).not.toContain("open_file");
  });

  test.each(["copilot", "codex"] as const)(
    "inherited Channel agent models preserve an existing %s provider when the workspace default changes",
    async (providerId) => {
      const { sessionId, db } = await setup("member");
      await stopProviders();
      onTestFinished(() => stopProviders());
      spyOn(cli, "isInstalled").mockImplementation((id) => id === "copilot" || id === "codex");
      for (const provider of [copilotProvider, codexProvider]) {
        spyOn(provider, "isSignedIn").mockResolvedValue(true);
        spyOn(provider, "listModels").mockResolvedValue([
          { id: "new-default", name: "New default", provider: provider.id },
          { id: "updated-model", name: "Updated model", provider: provider.id },
        ]);
      }
      await new ChannelDatabase(db).updateMember(sessionId, { model: null });
      const defaultModel = {
        provider: providerId === "copilot" ? "codex" : "copilot",
        name: "new-default",
      };
      spyOn(settings, "getSettings").mockResolvedValue({ ...DEFAULT_SETTINGS, defaultModel });
      expect(await getSessionConfiguration(sessionId)).toMatchObject({
        model: defaultModel,
      });

      await setSessionProvider(sessionId, { id: providerId, sessionId: "existing-native-session" });
      expect(await getSessionConfiguration(sessionId)).toMatchObject({
        model: undefined,
      });

      const sameProviderDefault = { provider: providerId, name: "updated-model" };
      spyOn(settings, "getSettings").mockResolvedValue({
        ...DEFAULT_SETTINGS,
        defaultModel: sameProviderDefault,
      });
      expect(await getSessionConfiguration(sessionId)).toMatchObject({
        model: sameProviderDefault,
      });
    },
  );

  test("Channel agents refresh changed configuration only between executions", async () => {
    const { sessionId, db, create, resume, handles } = await setup("member");
    const receipt = await createSession(
      sessionId,
      {
        systemMessage: { type: "channel_message", senderName: "You" },
      },
      {},
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
        "set_agent_status",
        "finish_agent_turn",
        "update_member",
      ]),
    );
    expect(initialToolNames).not.toContain("create_channel_members");
    expect(initialToolNames).not.toContain("list_sessions");
    expect(
      initialConfiguration.tools?.filter((tool) => tool.alwaysLoad).map((tool) => tool.name),
    ).toEqual([
      "read_channel",
      "set_agent_status",
      "react_to_channel_message",
      "share_channel_artifact",
      "run_wake_command",
      "finish_agent_turn",
      "send_channel_message",
      "update_member",
    ]);
    await new ChannelDatabase(db).updateMember(sessionId, {
      role: "Evolved role",
      avatar: { mark: "M5 12h14M12 5v14", color: "#7c3aed" },
      model: { provider: "copilot", name: "model-two" },
    });
    await deliverSessionMessage(sessionId, { content: "Continue", immediate: true });
    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    handles[0]!.finish();
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

    handles[1]!.finish();
    await deliverSessionMessage(sessionId, { content: "One more" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[1]!.disconnect).not.toHaveBeenCalled();
    expect(handles[1]!.send).toHaveBeenCalledTimes(3);
  });

  test("a lead model edit reaches its existing session on the next execution", async () => {
    const { sessionId, db, create, resume, handles } = await setup("lead");
    const channels = new ChannelDatabase(db);
    const agent = await channels.getAgent(sessionId);
    if (!agent) throw new Error("Channel lead not found.");
    const channel = await channels.getChannel(agent.channelId);
    if (!channel) throw new Error("Channel not found.");

    const initial = await createSession(sessionId, { content: "Start work" }, {});
    expect(create.mock.calls[0]![1].model).toEqual(channel.model);

    const model = { provider: "copilot", name: "gpt-6", reasoningEffort: "high" };
    await channels.editChannel({ channelId: channel.id, model });
    await deliverSessionMessage(sessionId, { content: "Still running", immediate: true });
    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    handles[0]!.finish();
    await initial.waitForCompletion();
    await deliverSessionMessage(sessionId, { content: "Continue" });
    expect(resume.mock.calls[0]![1].model).toEqual(model);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  test.each(["member", "lead"] as const)(
    "a %s moves to the channel's new directory only on its next execution",
    async (agentType) => {
      const { sessionId, db, create, resume, handles } = await setup(agentType);
      const channels = new ChannelDatabase(db);
      const agent = await channels.getAgent(sessionId);
      if (!agent) throw new Error("Channel agent not found.");
      const channel = await channels.getChannel(agent.channelId);
      if (!channel) throw new Error("Channel not found.");
      await channels.updateChannel(channel.id, { directory: "/workspace/original" });

      const first = await createSession(sessionId, { content: "Start work" }, {});
      expect(create.mock.calls[0]![1].directory).toBe("/workspace/original");
      await channels.updateChannel(channel.id, { directory: "/workspace/next" });
      await deliverSessionMessage(sessionId, { content: "Still running", immediate: true });
      expect(resume).not.toHaveBeenCalled();
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      handles[0]!.finish();
      await first.waitForCompletion();
      await deliverSessionMessage(sessionId, { content: "Continue" });
      expect(resume.mock.calls[0]![0]).toBe(sessionId);
      expect(resume.mock.calls[0]![1].directory).toBe("/workspace/next");
      expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);

      await channels.updateChannel(channel.id, { directory: null });
      handles[1]!.finish();
      await deliverSessionMessage(sessionId, { content: "Continue without a project" });
      expect(resume.mock.calls[1]![1].directory).toBeUndefined();
    },
  );

  test("bounded SDK operations do not refresh changed Channel agent configuration", async () => {
    const { sessionId, db, resume, handles } = await setup("member");
    await createSession(sessionId, { content: "Start" }, {});
    handles[0]!.finish();
    await new ChannelDatabase(db).updateMember(sessionId, {
      role: "Changed role",
      model: { provider: "copilot", name: "model-one" },
    });

    await registry.withConnection(sessionId, (connection) => connection.rename("Renamed"));

    expect(resume).not.toHaveBeenCalled();
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    await deliverSessionMessage(sessionId, { content: "Continue" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  test("automatic titles publish only accepted changes without a native event echo", async () => {
    const { sessionId, handles } = await setup();
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

  test.each([
    ["the snapshot's model when none is configured", undefined, undefined],
    ["a Channel agent's configured model over the snapshot's", "member", "model-one"],
  ] as const)("a cold resume applies %s", async (_, agent, configuredModel) => {
    const { sessionId, resume } = await setup(agent);
    const snapshotModel = { provider: "claude", name: "opus", reasoningEffort: "high" };
    spyOn(snapshots, "loadSessionSnapshot").mockResolvedValue(
      createInitialSessionState({ model: snapshotModel }),
    );

    await deliverSessionMessage(sessionId, { content: "Continue" });

    expect(resume.mock.calls[0]![1].model).toEqual(
      configuredModel ? { provider: "copilot", name: configuredModel } : snapshotModel,
    );
  });

  test("ordinary Sessions retain their cached connections between executions", async () => {
    const { sessionId, resume, handles } = await setup();
    await deliverSessionMessage(sessionId, { content: "First" });
    handles[0]!.finish();
    await deliverSessionMessage(sessionId, { content: "Second" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();
    expect(handles[0]!.send).toHaveBeenCalledTimes(2);
  });

  test("a cached connection that is gone is resumed fresh on the next delivery", async () => {
    const { sessionId, resume, handles } = await setup();
    await deliverSessionMessage(sessionId, { content: "First" });
    handles[0]!.finish();
    handles[0]!.send.mockRejectedValueOnce(new SessionConnectionUnavailableError("Gone"));

    await deliverSessionMessage(sessionId, { content: "Second" });

    expect(resume).toHaveBeenCalledTimes(2);
    expect(handles[1]!.send).toHaveBeenCalledWith(expect.objectContaining({ content: "Second" }));
  });

  test("a delivery while Stop awaits the provider starts the next turn once it confirms", async () => {
    const { sessionId, handles } = await setup();
    await deliverSessionMessage(sessionId, { content: "First" });
    const aborting = Promise.withResolvers<void>();
    const confirming = Promise.withResolvers<void>();
    handles[0]!.abort.mockImplementation(() => {
      aborting.resolve();
      return confirming.promise;
    });

    const stopping = abortSession(sessionId);
    await aborting.promise;
    const delivering = deliverSessionMessage(sessionId, { content: "Second" });
    confirming.resolve();
    await stopping;

    await expect(delivering).resolves.toMatchObject({ disposition: "started" });
    expect(handles[0]!.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "Second" }),
    );
  });

  test("a stop the provider never confirms leaves the next delivery a fresh connection", async () => {
    const { sessionId, resume, handles } = await setup();
    await deliverSessionMessage(sessionId, { content: "First" });
    const aborting = Promise.withResolvers<void>();
    handles[0]!.abort.mockImplementation(() => {
      aborting.resolve();
      return new Promise(() => {});
    });

    jest.useFakeTimers();
    try {
      const stopping = abortSession(sessionId);
      await aborting.promise;
      jest.advanceTimersByTime(5_000);
      await stopping;
    } finally {
      jest.useRealTimers();
    }
    await deliverSessionMessage(sessionId, { content: "Second" });

    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(handles[0]!.send).toHaveBeenCalledTimes(1);
    expect(handles[1]!.send).toHaveBeenCalledWith(expect.objectContaining({ content: "Second" }));
  });

  test.each([true, false])(
    "deletion waits for the native connection's final history flush (Stop confirmed=%s)",
    async (confirmed) => {
      const { sessionId, handles } = await setup();
      await deliverSessionMessage(sessionId, { content: "First" });
      const aborting = Promise.withResolvers<void>();
      handles[0]!.abort.mockImplementation(() => {
        aborting.resolve();
        return confirmed ? Promise.resolve() : new Promise(() => {});
      });
      jest.useFakeTimers();
      onTestFinished(() => jest.useRealTimers());
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

      const deletion = deleteSession(sessionId);
      await aborting.promise;
      if (!confirmed) jest.advanceTimersByTime(5_000);
      await disconnecting.promise;
      expect(isSessionRunning(sessionId)).toBe(false);
      expect(history).toBe("Transcript");
      disconnected.resolve();
      await deletion;
      expect(history).toBeUndefined();
    },
  );

  test("deletion stops waiting for an evicted connection after five seconds", async () => {
    const { sessionId, handles } = await setup();
    await deliverSessionMessage(sessionId, { content: "First" });
    handles[0]!.disconnect.mockImplementation(() => new Promise(() => {}));
    spyOn(sdk, "deleteSession").mockImplementation(async () => {});
    jest.useFakeTimers();
    onTestFinished(() => jest.useRealTimers());

    registry.evictConnection(sessionId);
    jest.advanceTimersByTime(5_000);
    await expect(deleteSession(sessionId)).resolves.toBeUndefined();
  });

  test("deletion during a creation removes the session the creation makes", async () => {
    const { sessionId, create } = await setup();
    const handle = makeSession();
    const creating = Promise.withResolvers<void>();
    create.mockImplementationOnce(async () => {
      await creating.promise;
      return { connection: handle.session, provider: { id: "copilot", sessionId: "test" } };
    });
    const deleteHistory = spyOn(sdk, "deleteSession").mockImplementation(async () => {});

    const created = createSession(sessionId, { content: "Start" }, {});
    const deletion = deleteSession(sessionId);
    creating.resolve();
    await created;
    await deletion;

    expect(await readSession(sessionId)).toBeUndefined();
    expect(deleteHistory).toHaveBeenCalledWith(sessionId);
    expect(isSessionRunning(sessionId)).toBe(false);
  });

  test("deletion during a creation's first send doesn't create the session again", async () => {
    const { sessionId, create, resume } = await setup();
    const handle = makeSession();
    const sent = Promise.withResolvers<void>();
    const sending = Promise.withResolvers<void>();
    handle.send.mockImplementationOnce(() => {
      sent.resolve();
      return sending.promise;
    });
    // Disconnecting fails the send still in flight, as a provider's closed transport does.
    handle.disconnect.mockImplementationOnce(async () =>
      sending.reject(new SessionConnectionUnavailableError("Disconnected")),
    );
    create.mockImplementationOnce(async () => ({
      connection: handle.session,
      provider: { id: "copilot", sessionId: "test" },
    }));
    spyOn(sdk, "deleteSession").mockImplementation(async () => {});

    const created = createSession(sessionId, { content: "Start" }, {});
    await sent.promise;
    await deleteSession(sessionId);

    await expect(created).resolves.toMatchObject({ disposition: "started" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(isSessionRunning(sessionId)).toBe(false);
  });

  test("Stop during a start stops the turn the start opens", async () => {
    const { sessionId, resume } = await setup();
    const handle = makeSession();
    const resuming = Promise.withResolvers<void>();
    resume.mockImplementationOnce(async () => {
      await resuming.promise;
      return handle.session;
    });

    const delivering = deliverSessionMessage(sessionId, { content: "First" });
    const stopping = abortSession(sessionId);
    resuming.resolve();
    await delivering;

    await expect(stopping).resolves.toBe(true);
    expect(handle.send).toHaveBeenCalledTimes(1);
    expect(handle.abort).toHaveBeenCalledTimes(1);
    expect(isSessionRunning(sessionId)).toBe(false);
  });

  test("deletion deletes provider history when the connection can't disconnect", async () => {
    const { sessionId, handles } = await setup();
    await deliverSessionMessage(sessionId, { content: "First" });
    handles[0]!.finish();
    handles[0]!.disconnect.mockRejectedValueOnce(new SessionConnectionUnavailableError("Gone"));
    spyOn(console, "error").mockImplementation(() => {});
    const deleteHistory = spyOn(sdk, "deleteSession").mockImplementation(async () => {});

    await deleteSession(sessionId);

    expect(deleteHistory).toHaveBeenCalledWith(sessionId);
  });

  test("disconnects after the idle window and waits for detach before resuming", async () => {
    const { sessionId, resume, handles } = await setup();
    jest.useFakeTimers();
    const disconnected = Promise.withResolvers<void>();
    try {
      await deliverSessionMessage(sessionId, { content: "First" });
      handles[0]!.disconnect.mockImplementation(() => disconnected.promise);
      jest.advanceTimersByTime(30 * 60 * 1000);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      handles[0]!.finish();
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
    disconnected.resolve();
    await nextExecution;
    expect(resume).toHaveBeenCalledTimes(2);
    expect(handles[1]!.send).toHaveBeenCalledTimes(1);
  });

  test("retains a cached connection when idle disconnect fails", async () => {
    const { sessionId, resume, handles } = await setup();

    await deliverSessionMessage(sessionId, { content: "First" });
    handles[0]!.finish();
    handles[0]!.disconnect.mockRejectedValueOnce(new Error("Detach failed"));

    await expect(registry.releaseIdleConnection(sessionId)).rejects.toThrow("Detach failed");
    await deliverSessionMessage(sessionId, { content: "Second" });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(handles[0]!.send).toHaveBeenCalledTimes(2);
  });

  test("short SDK operations restart idle connection retention", async () => {
    const { sessionId, handles } = await setup();

    jest.useFakeTimers();
    try {
      await deliverSessionMessage(sessionId, { content: "First" });
      handles[0]!.finish();
      jest.advanceTimersByTime(29 * 60 * 1000);

      const pendingOperation = Promise.withResolvers<void>();
      const operation = registry.withConnection(sessionId, () => pendingOperation.promise);
      await Promise.resolve();
      jest.advanceTimersByTime(2 * 60 * 1000);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      pendingOperation.resolve();
      await operation;
      jest.advanceTimersByTime(29 * 60 * 1000);
      expect(handles[0]!.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(60 * 1000);
      expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("supervisors release completed connections without interrupting execution", async () => {
    const { sessionId, resume, handles } = await setup();

    await deliverSessionMessage(sessionId, { content: "First" });
    await registry.releaseIdleConnection(sessionId);
    expect(handles[0]!.disconnect).not.toHaveBeenCalled();

    handles[0]!.finish();
    await registry.releaseIdleConnection(sessionId);
    expect(handles[0]!.disconnect).toHaveBeenCalledTimes(1);

    await deliverSessionMessage(sessionId, { content: "Second" });
    expect(resume).toHaveBeenCalledTimes(2);
    expect(handles[1]!.send).toHaveBeenCalledTimes(1);
  });
});
