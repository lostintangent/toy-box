import { expect, mock, test } from "bun:test";
import type { CopilotSession, SessionEvent as SdkEvent } from "@microsoft/copilot-sdk";
import type { SessionEvent } from "@sessions/model";
import { connectCopilotSession, holdNativeEvents } from "./connection";
import { encodeSystemMessage, systemMessagePrompt } from "@sessions/model/systemMessages";

test("native inputs carry their payloads and client IDs", async () => {
  const send = mock(async () => "native");
  const native = { sessionId: "native", on: () => () => {}, send } as unknown as CopilotSession;
  const connection = connectCopilotSession(native, holdNativeEvents());
  await connection.send({
    role: "user",
    clientId: "client",
    content: "prompt",
  });
  const content = { type: "channel_message" as const, senderName: "Ada" };
  await connection.send({ role: "system", clientId: "system", content, immediate: true });
  expect(send).toHaveBeenNthCalledWith(1, {
    prompt: "prompt",
    attachments: undefined,
    clientTurnId: "client",
  });
  expect(send).toHaveBeenLastCalledWith({
    prompt: systemMessagePrompt(content),
    displayPrompt: encodeSystemMessage(content),
    source: "system",
    mode: "immediate",
    clientTurnId: "system",
  });
});

test("Stop right after a send that starts a turn aborts once the CLI records it, so the prompt stays in history", async () => {
  let record!: (event: SdkEvent) => void;
  const calls: string[] = [];
  const native = {
    sessionId: "native",
    on: (handler: typeof record) => ((record = handler), () => {}),
    send: async () => void calls.push("send"),
    abort: async () => void calls.push("abort"),
  } as unknown as CopilotSession;
  const connection = connectCopilotSession(native, holdNativeEvents());

  await connection.send({ role: "user", clientId: "first", content: "Start" });
  const stopped = connection.abort();
  await Bun.sleep(10);
  expect(calls).toEqual(["send"]);

  record({ type: "user.message", data: { content: "Start", clientTurnId: "first" } } as SdkEvent);
  await stopped;
  expect(calls).toEqual(["send", "abort"]);
});

test("Stop during a steer aborts once the CLI has admitted it", async () => {
  const admitted = Promise.withResolvers<void>();
  const calls: string[] = [];
  const native = {
    sessionId: "native",
    on: () => () => {},
    send: () => admitted.promise.then(() => calls.push("send")),
    abort: async () => calls.push("abort"),
  } as unknown as CopilotSession;
  const connection = connectCopilotSession(native, holdNativeEvents());
  const sending = connection.send({
    role: "user",
    clientId: "steer",
    content: "Also",
    immediate: true,
  });
  const stopping = connection.abort();
  admitted.resolve();
  await Promise.all([sending, stopping]);
  expect(calls).toEqual(["send", "abort"]);
});

test("native lifecycle events end live turns", () => {
  let emit!: (event: SdkEvent) => void;
  const connection = connectCopilotSession(
    {
      sessionId: "native",
      on(handler: typeof emit) {
        emit = handler;
        return () => {};
      },
    } as unknown as CopilotSession,
    holdNativeEvents(),
  );
  const events: SessionEvent[] = [];
  connection.onEvent((event) => events.push(event));

  emit({ type: "assistant.turn_end", data: { turnId: "1" } } as SdkEvent);
  emit({ type: "assistant.idle", data: {} } as SdkEvent);
  emit({ type: "session.idle", data: {} } as SdkEvent);
  emit({
    type: "session.error",
    data: { message: "Native model history is incompatible." },
  } as SdkEvent);
  emit({ type: "abort", data: {} } as SdkEvent);

  expect(events).toEqual([
    { type: "status", status: "background" },
    { type: "end", reason: "idle" },
    { type: "end", reason: "error", error: "Native model history is incompatible." },
    { type: "end", reason: "error" },
  ]);
});

test("a model switch clears the session's effort when the configuration names none", async () => {
  const switchTo = mock(async (_request: object) => ({}));
  const connection = connectCopilotSession(
    { on: () => () => {}, rpc: { model: { switchTo } } } as unknown as CopilotSession,
    holdNativeEvents(),
  );
  await connection.setModel({
    provider: "copilot",
    name: "claude-opus-5.5",
    reasoningEffort: "xhigh",
  });
  await connection.setModel({ provider: "copilot", name: "claude-haiku-4.5" });
  expect(switchTo.mock.calls).toEqual([
    [{ modelId: "claude-opus-5.5", reasoningEffort: "xhigh" }],
    [{ modelId: "claude-haiku-4.5", reasoningEffort: null }],
  ]);
});

test("rewind resolves the requested timestamp to a native conversation boundary", async () => {
  const rewind = mock(async () => ({ eventsRemoved: 5 }));
  const connection = connectCopilotSession(
    {
      on: () => () => {},
      rpc: {
        history: {
          listRewindPoints: async () => ({
            points: [
              { eventId: "first", timestamp: "2026-08-14T19:00:00.000Z" },
              { eventId: "second", timestamp: "2026-08-14T20:00:00.000Z" },
            ],
          }),
          rewind,
        },
      },
    } as unknown as CopilotSession,
    holdNativeEvents(),
  );
  await connection.rewind("2026-08-14T20:00:00.000Z");
  expect(rewind).toHaveBeenCalledWith({ eventId: "second", mode: "conversation" });
});
