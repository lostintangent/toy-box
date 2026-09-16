import { expect, onTestFinished, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  applySessionEvent,
  createInitialSession,
  replaySessionHistory,
  sessionSeedFromSnapshot,
  toSessionSnapshot,
} from "@sessions/model/reducer";
import type { QueuedMessage, SessionEvent } from "@sessions/model";
import type { SessionConfiguration } from "@providers/server/provider";
import { defineTool } from "@sessions/server/tools/definition";
import { CodexConnection } from "./connection";
import { CodexTransport } from "./protocol/transport";
import * as transport from "./protocol/transport";
import { codexProvider } from "./provider";
import { itemTimestamp } from "./projector";
import type { Thread, ThreadItem, Turn, UserInput } from "./protocol";

const turn: Turn = {
  id: "00000001-0001-7001-8001-000000000001",
  startedAt: 65,
  completedAt: null,
  durationMs: null,
  itemsView: "full",
  items: [],
  status: "inProgress",
  error: null,
};
const userItem: ThreadItem = {
  type: "userMessage",
  id: "user",
  clientId: "input",
  content: [{ type: "text", text: "Hello", text_elements: [] }],
};
const assistantItem: ThreadItem = {
  type: "agentMessage",
  id: "reply",
  text: "Done",
  phase: "final_answer",
  memoryCitation: null,
  delivery: null,
  questions: null,
};

function sessionState(events: SessionEvent[]) {
  return events.reduce(applySessionEvent, createInitialSession());
}

function setup(tools: SessionConfiguration["tools"] = []) {
  const sessionId = `toy-box-test-${crypto.randomUUID()}`;
  const attachmentsDirectory = join(tmpdir(), sessionId, "attachments");
  const written: Record<string, unknown>[] = [];
  const responses = new Map<string, (value: unknown) => void>();
  const events: SessionEvent[] = [];
  let beforeStartResponse: (() => void) | undefined;
  let thread = {
    id: "native",
    historyMode: "paginated",
    model: "model-one",
    reasoningEffort: "low",
    name: null,
    turns: [{ ...turn, items: [userItem, assistantItem] }],
  } as Thread;
  const rpc = new CodexTransport((line) => {
    const request = JSON.parse(line) as {
      id: number;
      method?: string;
      params: Record<string, unknown>;
    };
    written.push(request);
    if (!request.method) {
      responses.get(String(request.id))?.(request);
      return;
    }
    let result: unknown = {};
    if (request.method === "turn/start") result = { turn };
    if (request.method === "turn/steer") result = { turnId: turn.id };
    if (request.method === "thread/read") result = { thread };
    if (request.method === "thread/turns/list") result = { data: thread.turns, nextCursor: null };
    queueMicrotask(() => {
      if (request.method === "turn/start") beforeStartResponse?.();
      rpc.receive(JSON.stringify({ id: request.id, result }) + "\n");
    });
  });
  const startClient = spyOn(transport, "startCodexClient").mockResolvedValue(rpc);
  const connection = new CodexConnection(
    rpc,
    { sessionId, providerId: "codex", nativeId: "native" },
    {
      directory: "/tmp",
      allowUserQuestions: true,
      attachmentsDirectory,
      tools,
      instructions: "Test",
      skillDirectories: [],
    },
    { provider: "codex", name: "model-one", reasoningEffort: "low" },
    [],
  );
  connection.onEvent((event) => events.push(event));
  const notify = (method: string, params: object) =>
    rpc.receive(JSON.stringify({ method, params: { threadId: "native", ...params } }) + "\n");
  const request = (id: string, method: string, params: object) =>
    rpc.receive(
      JSON.stringify({ id, method, params: { threadId: "native", turnId: turn.id, ...params } }) +
        "\n",
    );
  onTestFinished(async () => {
    await connection.disconnect();
    rpc.close();
    startClient.mockRestore();
    await rm(join(tmpdir(), sessionId), { recursive: true, force: true });
  });
  return {
    connection,
    readHistory: () => codexProvider.readHistory(connection.identity),
    rpc,
    notify,
    request,
    written,
    events,
    sessionId,
    callTool: (id: string, name: string, args: unknown, namespace = "toy_box") =>
      new Promise<unknown>((resolve) => {
        responses.set(id, resolve);
        request(id, "item/tool/call", {
          namespace,
          tool: name,
          arguments: args,
          callId: `${id}-call`,
        });
      }),
    beforeStartResponse: (callback: () => void) => {
      beforeStartResponse = callback;
    },
    setThread: (value: Thread) => {
      thread = value;
    },
  };
}

test("a late turn/start response never reactivates a completed Codex turn", async () => {
  const { connection, notify, beforeStartResponse, written } = setup();
  beforeStartResponse(() => {
    notify("turn/started", { turn });
    notify("turn/completed", { turn: { ...turn, status: "completed" } });
  });
  await connection.send({ role: "user", clientId: "first", content: "Start" });
  await expect(
    connection.send({ role: "user", clientId: "steer", content: "Late" }, true),
  ).rejects.toThrow("turn has ended");
  expect(written.some(({ method }) => method === "turn/steer")).toBe(false);
});

test("native plan notifications reach the shared session state", () => {
  const { notify, events } = setup();
  notify("turn/plan/updated", {
    turnId: turn.id,
    explanation: null,
    plan: [{ step: "Validate the provider", status: "inProgress" }],
  });
  expect(sessionState(events).todos).toEqual([
    { id: "codex-plan-0", title: "Validate the provider", status: "in_progress" },
  ]);
});

test("imported local media is restored while missing media retains its file reference", async () => {
  const { readHistory, setThread } = setup();
  const directory = await mkdtemp(join(tmpdir(), "toy-box-media-test-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const image = join(directory, "image.png");
  const audio = join(directory, "audio.wav");
  await Bun.write(image, "image bytes");
  await Bun.write(audio, "audio bytes");
  setThread({
    id: "native",
    historyMode: "legacy",
    turns: [
      {
        ...turn,
        items: [
          {
            ...userItem,
            content: [
              { type: "localImage", path: image },
              { type: "localAudio", path: audio },
              { type: "localImage", path: join(directory, "missing.png") },
            ],
          },
        ],
      },
    ],
  } as Thread);
  const message = (await readHistory()).find((event) => event.type === "user_message");
  expect(
    message?.attachments?.map(({ base64 }) => Buffer.from(base64, "base64").toString()),
  ).toEqual(["image bytes", "audio bytes"]);
  expect(message?.content).toContain("missing.png");
});

test("automatic titles preserve names on imported Codex conversations", async () => {
  const { connection, setThread, written } = setup();
  setThread({ id: "native", name: "Owner title", turns: [] } as unknown as Thread);
  expect(await connection.rename("Inferred title", true)).toBe(false);
  expect(written.some(({ method }) => method === "thread/name/set")).toBe(false);
  expect(await connection.rename("New explicit title")).toBe(true);
});

test("Codex starts and steers the same turn with public input identity and per-turn model options", async () => {
  const { connection, notify, written } = setup();
  await connection.setModel({ provider: "codex", name: "model-two", reasoningEffort: "high" });
  await connection.send({ role: "user", clientId: "first", content: "Start" });
  notify("turn/started", { turn });
  await connection.send({ role: "user", clientId: "second", content: "Steer" }, true);
  expect(written[0]).toMatchObject({
    method: "turn/start",
    params: {
      threadId: "native",
      clientUserMessageId: "first",
      model: "model-two",
      effort: "high",
    },
  });
  expect(written[1]).toMatchObject({
    method: "turn/steer",
    params: { expectedTurnId: turn.id, clientUserMessageId: "second" },
  });
});

test("Codex live text, snapshot resume, and native history preserve message boundaries", async () => {
  const { connection, readHistory, notify, events, setThread } = setup();
  await connection.send({ role: "user", clientId: "input", content: "Hello" });
  notify("turn/started", { turn });
  notify("item/started", { turnId: turn.id, item: userItem });
  notify("item/completed", { turnId: turn.id, item: userItem });
  notify("item/reasoning/textDelta", { turnId: turn.id, itemId: "reason", delta: "Thinking" });
  notify("item/reasoning/summaryTextDelta", { turnId: turn.id, itemId: "reason", delta: " more" });
  expect(sessionState(events).reasoningContent).toBe("Thinking more");
  notify("item/agentMessage/delta", { turnId: turn.id, itemId: assistantItem.id, delta: "Do" });
  expect(sessionState(events).messages.at(-1)).toMatchObject({ role: "assistant", content: "Do" });
  expect(sessionState(events).status).toBe("responding");
  notify("item/agentMessage/delta", {
    turnId: turn.id,
    itemId: assistantItem.id,
    delta: "ne (draft)",
  });
  const snapshot = toSessionSnapshot(connection.identity.sessionId, sessionState(events));
  const resumeFrom = events.length;
  notify("item/completed", { turnId: turn.id, item: assistantItem });
  const repeated = { ...assistantItem, id: "repeated" };
  const extended = { ...assistantItem, id: "extended", text: "Done again" };
  notify("item/completed", { turnId: turn.id, item: repeated });
  notify("item/agentMessage/delta", { turnId: turn.id, itemId: extended.id, delta: extended.text });
  notify("thread/name/updated", { threadName: "A shared title" });
  const completedTurn: Turn = {
    ...turn,
    status: "completed",
    items: [userItem, assistantItem, repeated, extended],
  };
  notify("turn/completed", { turn: completedTurn });
  setThread({
    id: "native",
    historyMode: "paginated",
    name: "A shared title",
    turns: [completedTurn],
  } as Thread);
  const history = await readHistory();
  const live = sessionState(events);
  const replay = history.reduce(applySessionEvent, createInitialSession());
  expect(live.messages).toEqual(replay.messages);
  const resumed = events
    .slice(resumeFrom)
    .reduce(applySessionEvent, createInitialSession(sessionSeedFromSnapshot(snapshot)));
  expect(resumed.messages).toEqual(live.messages);
  expect(live.messages.map((message) => message.content)).toEqual([
    "Hello",
    "Done",
    "Done",
    "Done again",
  ]);
  expect(live.title).toBe("A shared title");
  expect(live.title).toBe(replay.title);
  expect(live.status).toBe("idle");
});

test.each([null, "You've hit your usage limit."])(
  "Codex turn errors agree live and after reopening: %s",
  async (message) => {
    const { readHistory, notify, events, setThread } = setup();
    const failedTurn: Turn = {
      ...turn,
      status: "failed",
      items: [userItem],
      error: message
        ? {
            message,
            codexErrorInfo: "usageLimitExceeded",
            additionalDetails: null,
            misalignment: null,
          }
        : null,
    };
    notify("turn/started", { turn });
    notify("item/completed", { turnId: turn.id, item: userItem });
    notify("turn/completed", { turn: failedTurn });
    setThread({ id: "native", historyMode: "paginated", turns: [failedTurn] } as Thread);
    expect(sessionState(events).messages).toEqual(
      replaySessionHistory(await readHistory()).messages,
    );
    expect(sessionState(events).messages.at(-1)).toEqual({
      role: "assistant",
      content: "",
      error: message ?? "An error occurred. Please try again.",
    });
  },
);

test("Codex retries and interruptions do not create transcript errors", () => {
  const { notify, events } = setup();
  notify("turn/started", { turn });
  notify("item/completed", { turnId: turn.id, item: userItem });
  notify("error", {
    turnId: turn.id,
    willRetry: true,
    error: { message: "Reconnecting", codexErrorInfo: "serverOverloaded" },
  });
  expect(sessionState(events).status).toBe("thinking");
  expect(sessionState(events).messages).toHaveLength(1);
  notify("turn/completed", { turn: { ...turn, status: "interrupted" } });
  expect(sessionState(events).messages).toHaveLength(1);
  expect(sessionState(events).status).toBe("idle");
});

test("native question resolution cancels only unanswered questions in the batch", async () => {
  const { connection, notify, request, events } = setup();
  notify("turn/started", { turn });
  request("questions", "item/tool/requestUserInput", {
    itemId: "ask",
    isBlocking: false,
    autoResolutionMs: null,
    questions: ["first", "second"].map((id) => ({
      id,
      header: id,
      question: id,
      isOther: true,
      isSecret: false,
      options: null,
    })),
  });
  const questions = events.filter((event) => event.type === "question_requested");
  await connection.answerQuestion({
    requestId: questions[0]!.requestId,
    answer: "Answered",
    wasFreeform: true,
  });
  notify("serverRequest/resolved", { requestId: "questions" });
  expect(events.filter((event) => event.type === "question_cancelled")).toEqual([
    { type: "question_cancelled", toolCallId: questions[1]!.toolCallId },
  ]);
  expect(
    await connection.answerQuestion({
      requestId: questions[1]!.requestId,
      answer: "Late",
      wasFreeform: true,
    }),
  ).toBe(false);
});

test("Codex replays attachments and system messages entirely from native input", async () => {
  const { connection, readHistory, setThread, written } = setup();
  const message: QueuedMessage = {
    role: "user",
    clientId: "input",
    content: "Review",
    attachments: [
      { mimeType: "image/png", base64: "aW1hZ2U=" },
      { mimeType: "text/plain", base64: "bm90ZXM=" },
    ],
  };
  await connection.send(message);
  const requestInput = (written[0]!.params as { input: UserInput[] }).input;
  setThread({
    id: "native",
    historyMode: "paginated",
    turns: [{ ...turn, items: [{ ...userItem, content: requestInput }] }],
  } as Thread);
  expect((await readHistory()).find((event) => event.type === "user_message")).toMatchObject({
    content: message.content,
    attachments: message.attachments,
  });
  const system: QueuedMessage = {
    role: "system",
    clientId: "system",
    content: { type: "channel_message", senderName: "Ada" },
  };
  await connection.send(system);
  const systemInput = (
    written.filter(({ method }) => method === "turn/start").at(-1)!.params as { input: UserInput[] }
  ).input;
  setThread({
    id: "native",
    historyMode: "legacy",
    turns: [{ ...turn, items: [{ ...userItem, clientId: "system", content: systemInput }] }],
  } as Thread);
  expect(await readHistory()).toContainEqual({
    type: "system_message",
    content: system.content,
    clientId: "system",
    timestamp: itemTimestamp(turn, 0),
  });
});

test("multi-question input resolves live cards and gathers one native response", async () => {
  const { connection, notify, request, written, events } = setup();
  notify("turn/started", { turn });
  notify("item/started", { turnId: turn.id, item: userItem });
  request("questions", "item/tool/requestUserInput", {
    itemId: "ask",
    isBlocking: true,
    autoResolutionMs: null,
    questions: ["color", "title"].map((id) => ({
      id,
      header: id,
      question: `Choose ${id}`,
      isOther: true,
      isSecret: false,
      options: [
        { label: "Yes", description: "Accept" },
        { label: "No", description: "Decline" },
      ],
    })),
  });
  const questions = events.filter((event) => event.type === "question_requested");
  expect(questions).toHaveLength(2);
  expect(sessionState(events).status).toBe("waiting");
  await expect(
    connection.answerQuestion({
      requestId: questions[0]!.requestId,
      answer: "Yes",
      wasFreeform: false,
    }),
  ).resolves.toBe(true);
  expect(written.some((message) => message.id === "questions")).toBe(false);
  await expect(
    connection.answerQuestion({
      requestId: questions[0]!.requestId,
      answer: "No",
      wasFreeform: false,
    }),
  ).resolves.toBe(false);
  await connection.answerQuestion({
    requestId: questions[1]!.requestId,
    answer: "No",
    wasFreeform: false,
  });
  expect(written.find((message) => message.id === "questions")).toEqual({
    id: "questions",
    result: { answers: { color: { answers: ["Yes"] }, title: { answers: ["No"] } } },
  });
  const answers = sessionState(events).messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls?.map((tool) => tool.question) ?? []) : [],
  );
  expect(answers).toHaveLength(2);
  expect(answers).toEqual([
    expect.objectContaining({ state: "answered", answer: "Yes" }),
    expect.objectContaining({ state: "answered", answer: "No" }),
  ]);
});

test("native tools validate arguments, retain public identity, and terminate after native completion", async () => {
  const invoked: unknown[] = [];
  const terminal = defineTool("finish_test", {
    parameters: z.object({ value: z.string() }),
    isTerminal: true,
    handler: (args, invocation) => {
      invoked.push({ args, sessionId: invocation.sessionId });
      return "Accepted";
    },
  });
  const { connection, notify, callTool, written, sessionId } = setup([terminal]);
  notify("turn/started", { turn });
  expect(await callTool("invalid", "finish_test", { value: 3 })).toMatchObject({
    result: { success: false },
  });
  expect(invoked).toEqual([]);
  expect(await callTool("valid", "finish_test", { value: "ok" })).toMatchObject({
    result: { success: true, contentItems: [{ type: "inputText", text: "Accepted" }] },
  });
  expect(invoked).toEqual([{ args: { value: "ok" }, sessionId }]);
  expect(written.some((message) => message.method === "turn/interrupt")).toBe(false);
  notify("item/completed", {
    turnId: turn.id,
    item: {
      type: "dynamicToolCall",
      id: "valid-call",
      namespace: "toy_box",
      tool: "finish_test",
      arguments: { value: "ok" },
      status: "completed",
      contentItems: [{ type: "inputText", text: "Accepted" }],
      success: true,
      durationMs: null,
    },
  });
  expect(written.find((message) => message.method === "turn/interrupt")).toMatchObject({
    method: "turn/interrupt",
    params: { turnId: turn.id },
  });
  expect(await callTool("later", "finish_test", { value: "unexpected" })).toMatchObject({
    result: { success: false },
  });
  expect(invoked).toHaveLength(1);
  await connection.abort();
});

test.each(["abort", "completion", "disconnect"] as const)(
  "%s cancels the session's pending native tools",
  async (end) => {
    const entered = Promise.withResolvers<void>();
    const held = defineTool("held", {
      handler: async (_args, { signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) =>
          signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
        return "Finished after cancellation";
      },
    });
    const { connection, notify, callTool } = setup([held]);
    notify("turn/started", { turn });
    const response = callTool("held", "held", {});
    await entered.promise;
    if (end === "completion") notify("turn/completed", { turn: { ...turn, status: "completed" } });
    else if (end === "abort") await connection.abort();
    else await connection.disconnect();
    expect(await response).toMatchObject({ result: { success: false } });
  },
);

test("native tools return text and images and reject calls outside the Toy Box namespace", async () => {
  const preview = defineTool("preview", {
    handler: () => ({
      content: [
        { type: "text", text: "Preview" },
        { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
      ],
    }),
  });
  const { notify, callTool } = setup([preview]);
  notify("turn/started", { turn });
  expect(await callTool("image", "preview", {})).toMatchObject({
    result: {
      success: true,
      contentItems: [
        { type: "inputText", text: "Preview" },
        { type: "inputImage", imageUrl: "data:image/png;base64,aW1hZ2U=" },
      ],
    },
  });
  expect(await callTool("external", "preview", {}, "another_app")).toMatchObject({
    error: { code: -32601 },
  });
});

test("rewind chooses the native history contract and rejects a mid-turn steer boundary", async () => {
  const { connection, setThread, written } = setup();
  await connection.rewind(itemTimestamp(turn, 0));
  expect(written).toContainEqual(
    expect.objectContaining({
      method: "thread/revert",
      params: { threadId: "native", beforeTurnId: turn.id },
    }),
  );
  setThread({
    id: "native",
    historyMode: "legacy",
    turns: [{ ...turn, items: [userItem, { ...userItem, id: "steer" }] }],
  } as Thread);
  await expect(connection.rewind(itemTimestamp(turn, 1))).rejects.toThrow("start of a turn");
  await connection.rewind(itemTimestamp(turn, 0));
  expect(written).toContainEqual(
    expect.objectContaining({
      method: "thread/rollback",
      params: { threadId: "native", numTurns: 1 },
    }),
  );
});
