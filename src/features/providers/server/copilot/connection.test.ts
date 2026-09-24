import { expect, mock, test } from "bun:test";
import type { CopilotSession, SessionEvent as SdkEvent } from "@github/copilot-sdk";
import type { SessionEvent } from "@sessions/model";
import { connectCopilotSession } from "./connection";
import { encodeSystemMessage, systemMessagePrompt } from "@sessions/model/systemMessages";

test("native inputs retain payloads and client identity through interleaved echoes", async () => {
  let emit!: (event: SdkEvent) => void;
  let nextId = 0;
  const send = mock(async () => `native-${++nextId}`);
  const native = {
    sessionId: "native",
    on(handler: typeof emit) {
      emit = handler;
      return () => {};
    },
    send,
  } as unknown as CopilotSession;
  const connection = connectCopilotSession(native, "public");
  const events: SessionEvent[] = [];
  connection.onEvent((event) => events.push(event));
  await connection.send({
    role: "user",
    clientId: "client",
    content: "same prompt",
  });
  await connection.send({
    role: "user",
    clientId: "steer",
    content: "same prompt",
    immediate: true,
  });
  const content = { type: "channel_message" as const, senderName: "Ada" };
  await connection.send({ role: "system", clientId: "system", content, immediate: true });
  expect(send).toHaveBeenLastCalledWith({
    prompt: systemMessagePrompt(content),
    displayPrompt: encodeSystemMessage(content),
    source: "system",
    mode: "immediate",
  });
  expect(send).toHaveBeenNthCalledWith(1, {
    prompt: "same prompt",
    attachments: undefined,
  });
  emit({
    type: "user.message",
    data: { content: "internal skill prompt", messageId: "internal", source: "skill-plan" },
  } as SdkEvent);
  expect(events).toEqual([]);
  emit({
    type: "user.message",
    data: { content: encodeSystemMessage(content), messageId: "native-3" },
  } as SdkEvent);
  emit({
    type: "user.message",
    data: { content: "same prompt", messageId: "native-2" },
  } as SdkEvent);
  emit({
    type: "user.message",
    data: { content: "same prompt", messageId: "native-1" },
  } as SdkEvent);
  emit({ type: "assistant.message_delta", data: { deltaContent: "Reply" } } as SdkEvent);
  expect(events).toMatchObject([
    { type: "system_message", content, clientId: "system" },
    { type: "user_message", content: "same prompt", clientId: "steer" },
    { type: "user_message", content: "same prompt", clientId: "client" },
    { type: "delta", content: "Reply" },
  ]);
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
    "public",
  );
  const events: SessionEvent[] = [];
  connection.onEvent((event) => events.push(event));

  emit({ type: "assistant.turn_end", data: { turnId: "1" } } as SdkEvent);
  emit({ type: "session.idle", data: {} } as SdkEvent);
  emit({ type: "session.error", data: {} } as SdkEvent);
  emit({ type: "abort", data: {} } as SdkEvent);

  expect(events).toEqual([
    { type: "end", reason: "idle" },
    { type: "end", reason: "error" },
    { type: "end", reason: "error" },
  ]);
});

test("abort clears native queued input and still interrupts if clearing fails", async () => {
  const calls: string[] = [];
  const connection = connectCopilotSession(
    {
      rpc: {
        queue: {
          clear: async () => {
            calls.push("clear");
            throw new Error("clear failed");
          },
        },
      },
      abort: async () => {
        calls.push("abort");
      },
    } as unknown as CopilotSession,
    "public",
  );
  await expect(connection.abort()).rejects.toThrow("clear failed");
  expect(calls).toEqual(["clear", "abort"]);
});

test("rewind resolves the requested timestamp to a native conversation boundary", async () => {
  const rewind = mock(async () => ({ eventsRemoved: 5 }));
  const connection = connectCopilotSession(
    {
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
    "public",
  );
  await connection.rewind("2026-08-14T20:00:00.000Z");
  expect(rewind).toHaveBeenCalledWith({ eventId: "second", mode: "conversation" });
});
