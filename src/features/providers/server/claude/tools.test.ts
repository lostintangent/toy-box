import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createClaudeTools } from "./tools";

test("SDK tools preserve recursive schemas, validation, public identity, and terminal results", async () => {
  const server = createClaudeTools("public-session", [
    {
      name: "echo",
      parameters: z
        .object({ value: z.json(), allowed: z.boolean() })
        .refine((args) => args.allowed),
      handler: (args, context) => {
        expect(context.sessionId).toBe("public-session");
        expect(context.toolCallId).toBe("native-call");
        expect(context.signal).toBeInstanceOf(AbortSignal);
        return args.value;
      },
    },
    { name: "finish", isTerminal: true, handler: () => "Done" },
  ]);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.instance.connect(serverTransport), client.connect(clientTransport)]);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["echo", "finish"]);
    const args = { value: { nested: ["value", null] }, allowed: true };
    expect(
      await client.callTool({
        name: "echo",
        arguments: args,
        _meta: { "claudecode/toolUseId": "native-call" },
      }),
    ).toMatchObject({ content: [{ type: "text", text: JSON.stringify(args.value) }] });
    expect(
      await client.callTool({ name: "echo", arguments: { ...args, allowed: false } }),
    ).toMatchObject({ isError: true });
    expect(await client.callTool({ name: "finish", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "Done" }],
      _meta: { "claude/endTurn": true },
    });
  } finally {
    await client.close();
    await server.instance.close();
  }
});
