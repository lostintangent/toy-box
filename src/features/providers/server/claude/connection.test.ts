import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import * as client from "./client";
import { ClaudeConnection } from "./connection";

/** A CLI that records what reaches it, and replays what the test says it took up. */
async function connectToFakeCli() {
  const wire: string[] = [];
  const written: SDKUserMessage[] = [];
  let reply!: ReadableStreamDefaultController<SDKMessage>;
  const output = new ReadableStream<SDKMessage>({
    start: (controller) => void (reply = controller),
  });
  const start = spyOn(client, "startClaudeQuery").mockImplementation(
    (_options, prompt?: AsyncIterable<SDKUserMessage>) => {
      // Like the SDK, write each input before reading the next.
      void (async () => {
        for await (const input of prompt ?? []) {
          await Bun.sleep(1);
          wire.push(input.type);
          written.push(input);
        }
      })();
      return {
        initializationResult: async () => ({}),
        interrupt: async () => void wire.push("interrupt"),
        [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
        return: async () => ({ done: true, value: undefined }),
      } as unknown as Query;
    },
  );
  onTestFinished(() => start.mockRestore());
  const connection = await ClaudeConnection.open("native", {
    directory: "/tmp",
    allowUserQuestions: false,
    tools: [],
    instructions: "",
    skillDirectories: [],
  });
  onTestFinished(() => connection.disconnect());
  return {
    connection,
    wire,
    async takeUp(index: number) {
      while (!written[index]) await Bun.sleep(0);
      reply.enqueue({ ...written[index], isReplay: true } as SDKMessage);
    },
  };
}

test("Stop right after a send that starts a turn interrupts once the CLI takes it up, so the prompt stays in history", async () => {
  const cli = await connectToFakeCli();

  await cli.connection.send({ role: "user", clientId: "first", content: "Start" });
  const stopped = cli.connection.abort();
  await Bun.sleep(10);
  expect(cli.wire).toEqual(["user"]);

  await cli.takeUp(0);
  await stopped;
  expect(cli.wire).toEqual(["user", "interrupt"]);
});

test("Stop right after a steer interrupts once the SDK has written it, so the CLI cancels it", async () => {
  const cli = await connectToFakeCli();
  await cli.connection.send({ role: "user", clientId: "first", content: "Start" });
  await cli.takeUp(0);

  await cli.connection.send({ role: "user", clientId: "steer", content: "Also", immediate: true });
  await cli.connection.abort();

  expect(cli.wire).toEqual(["user", "user", "interrupt"]);
});
