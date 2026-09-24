import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { applySessionEvent, createInitialSessionState } from "@sessions/model/reducer";
import { computeFileDiffStats, getToolCallFileDiffs } from "@sessions/model/fileDiffs";
import { getModelReasoningConfig, modelCatalogKey, modelConfigurationKey } from "@providers/model";
import { createClaudeProjector } from "./projector";
import { toModelInfo } from "./models";

const native = (value: unknown) => value as SDKMessage;
const assistant = (content: unknown[], id = "reply", parent_tool_use_id: string | null = null) =>
  native({
    type: "assistant",
    message: { id, model: "claude-model", content },
    parent_tool_use_id,
  });

test("catalog, startup, and history agree on the model and its reasoning options", () => {
  const catalog = [
    toModelInfo({
      value: "opus[1m]",
      resolvedModel: "claude-opus-5-5[1m]",
      displayName: "Opus (1M context)",
      description: "",
      supportedEffortLevels: ["low", "high"],
    }),
  ];
  const messages = [
    native({ type: "system", subtype: "init", model: "claude-opus-5-5[1m]" }),
    ...["claude-opus-5-5", "claude-opus-5-5[1M]"].map((model) =>
      native({
        type: "assistant",
        message: { id: "reply", model, content: [{ type: "text", text: "Done." }] },
        effort: "high",
      }),
    ),
  ];
  for (const message of messages) {
    const state = createClaudeProjector("test")(message).reduce(
      applySessionEvent,
      createInitialSessionState(),
    );
    expect(state.model?.name).toBe("claude-opus-5-5");
    const selected = catalog.find(
      (model) => modelCatalogKey(model) === modelConfigurationKey(state.model!),
    );
    expect(selected?.name).toBe("Opus 5.5");
    expect(getModelReasoningConfig(selected, state.model?.reasoningEffort)).toEqual({
      supportedReasoningEfforts: ["low", "high"],
      reasoningEffort: message.type === "assistant" ? "high" : "low",
    });
  }
});

test("turn results do not finish a session before native idle", () => {
  const project = createClaudeProjector("test");
  expect(project(native({ type: "result", subtype: "success", is_error: false }))).toEqual([]);
  expect(
    project(native({ type: "system", subtype: "session_state_changed", state: "idle" })),
  ).toEqual([{ type: "end", reason: "idle" }]);
});

test.each(["[Request interrupted by user]", "[Request interrupted by user for tool use]"])(
  "replay hides the native interruption notice %s without hiding user input",
  (text) => {
    const notice = {
      type: "user",
      message: { content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    };
    const messages = [
      notice,
      { ...notice, origin: { kind: "human" } },
      { ...notice, message: { content: [{ type: "text", text: `What does ${text} mean?` }] } },
    ];
    const state = messages
      .map(native)
      .flatMap(createClaudeProjector("test"))
      .reduce(applySessionEvent, createInitialSessionState());
    expect(state.messages.map((message) => message.content)).toEqual([
      text,
      `What does ${text} mean?`,
    ]);
  },
);

test("native tool results replay edits, a completed checklist, and an answered question", async () => {
  const messages = (await Bun.file(new URL("./transcript.fixture.jsonl", import.meta.url)).text())
    .trim()
    .split("\n")
    .map((line) => native(JSON.parse(line)));
  const project = createClaudeProjector("toy-box-test");
  const state = messages.flatMap(project).reduce(applySessionEvent, createInitialSessionState());
  const calls = state.messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );
  expect(state.todos).toEqual([{ id: "1", title: "Verify the probe", status: "done" }]);
  expect(calls.find((call) => call.question)?.question).toMatchObject({
    question: "Do you want Red or Blue?",
    choices: ["Red", "Blue"],
    answer: "Red",
  });
  const diffs = calls.flatMap((call) => getToolCallFileDiffs(call) ?? []);
  expect(computeFileDiffStats(diffs).total).toEqual({ added: 3, removed: 1 });
  expect(diffs[1]?.hunks[0]?.lines).toContainEqual({ type: "removed", text: "alpha" });
  expect(diffs[1]?.hunks[0]?.lines).toContainEqual({ type: "added", text: "gamma" });
  expect(calls.find((call) => call.name === "finish")?.result).toMatchObject({
    success: true,
    content: "FINISHED",
  });
  expect(calls.some((call) => ["ToolSearch", "TaskCreate", "TaskUpdate"].includes(call.name))).toBe(
    false,
  );
});

test("streaming and committed text blocks converge on one assistant message", () => {
  const committed = [
    assistant([{ type: "text", text: "Hello " }]),
    assistant([{ type: "text", text: "world" }]),
  ];
  const stream = [
    native({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_start", message: { id: "reply" } },
    }),
    native({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
    }),
    committed[0]!,
    native({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
    }),
    committed[1]!,
  ];
  const reduce = (messages: SDKMessage[]) =>
    messages
      .flatMap(createClaudeProjector("test"))
      .reduce(applySessionEvent, createInitialSessionState()).messages;
  expect(reduce(stream)).toEqual(reduce(committed));
  expect(reduce(stream)).toHaveLength(1);
  expect(reduce(stream)[0]?.content).toBe("Hello world");
});

test("thinking summaries survive token progress and start fresh for the next block", () => {
  const project = createClaudeProjector("test");
  let state = createInitialSessionState();
  const receive = (message: SDKMessage) => {
    state = project(message).reduce(applySessionEvent, state);
  };
  const stream = (event: unknown) => native({ type: "stream_event", event });
  const start = stream({
    type: "content_block_start",
    content_block: { type: "thinking", thinking: "" },
  });
  const delta = stream({
    type: "content_block_delta",
    delta: { type: "thinking_delta", thinking: "ha" },
  });
  const committed = assistant([{ type: "thinking", thinking: "haha" }]);
  const progress = native({ type: "system", subtype: "thinking_tokens", estimated_tokens: 2 });

  receive(start);
  expect(state.status).toBe("reasoning");
  receive(delta);
  receive(progress);
  receive(delta);
  receive(progress);
  expect(state.reasoningContent).toBe("haha");
  receive(committed);
  expect(state).toEqual(
    createClaudeProjector("test")(committed).reduce(applySessionEvent, createInitialSessionState()),
  );
  receive(start);
  expect(state.reasoningContent).toBe("");
  receive(delta);
  expect(state.reasoningContent).toBe("ha");
});

test("background history retains the launch result and nested child activity", () => {
  const messages = [
    assistant([
      {
        type: "tool_use",
        id: "child",
        name: "Task",
        input: { prompt: "Inspect", subagent_type: "Explore", run_in_background: true },
      },
    ]),
    assistant(
      [{ type: "tool_use", id: "read", name: "Read", input: { file_path: "/project/file.ts" } }],
      "child-reply",
      "child",
    ),
    native({
      type: "user",
      parent_tool_use_id: "child",
      message: { content: [{ type: "tool_result", tool_use_id: "read", content: "hello" }] },
    }),
    assistant([{ type: "text", text: "Inspected." }], "child-reply", "child"),
    native({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "child", content: "Launched" }] },
      tool_use_result: { status: "async_launched", agentId: "agent" },
    }),
    native({
      type: "user",
      origin: { kind: "task-notification" },
      message: { content: "Internal background task notification" },
    }),
  ];
  const state = messages
    .flatMap(createClaudeProjector("test"))
    .reduce(applySessionEvent, createInitialSessionState());
  const root = state.messages.find((message) => message.role === "assistant");
  expect(root?.toolCalls?.[0]).toMatchObject({
    name: "agent",
    result: { success: true, content: "Launched" },
    subagent: {
      content: "Inspected.",
      toolCalls: [{ name: "read", result: { success: true, content: "hello" } }],
    },
  });
  expect(state.messages).toHaveLength(1);
});

test.each(["completed", "failed", "stopped"] as const)(
  "a background agent stays running until its native %s notification",
  (status) => {
    const project = createClaudeProjector("test");
    let state = createInitialSessionState({ status: "thinking" });
    const receive = (message: unknown) => {
      state = project(native(message)).reduce(applySessionEvent, state);
    };
    receive(
      assistant([
        { type: "tool_use", id: "child", name: "Task", input: { run_in_background: true } },
      ]),
    );
    receive({
      type: "system",
      subtype: "task_started",
      task_id: "agent",
      tool_use_id: "child",
      is_backgrounded: true,
    });
    receive({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "child", content: "Launched" }] },
      tool_use_result: { status: "async_launched", agentId: "agent" },
    });
    receive(assistant([{ type: "text", text: "Child output" }], "child-reply", "child"));
    const agent = () =>
      state.messages.find((message) => message.role === "assistant")?.toolCalls?.[0];
    expect(agent()?.result).toBeUndefined();
    expect(agent()?.subagent?.content).toBe("Child output");

    receive({
      type: "system",
      subtype: "task_notification",
      task_id: "agent",
      tool_use_id: "child",
      status,
      summary: "Task outcome",
    });
    expect(agent()?.result).toMatchObject({
      success: status === "completed",
      content: "Task outcome",
    });
    expect(state.status).not.toBe("idle");
  },
);
