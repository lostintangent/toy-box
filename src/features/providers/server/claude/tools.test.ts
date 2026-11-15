import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { toolInputSchema } from "../provider";
import { createClaudeTools } from "./tools";

test("SDK tools list shared schemas and report rejections, loading, and terminal results", async () => {
  const parameters = z
    .object({ value: z.json(), allowed: z.boolean() })
    .refine((args) => args.allowed, "Not allowed");
  const server = createClaudeTools([
    {
      name: "echo",
      parameters,
      handler: async (args) => JSON.stringify(parameters.parse(args).value),
    },
    { name: "finish", isTerminal: true, alwaysLoad: true, handler: async () => "Done" },
  ]);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.instance.connect(serverTransport), client.connect(clientTransport)]);
    expect<unknown>(
      (await client.listTools()).tools.map(({ name, inputSchema, _meta }) => ({
        name,
        inputSchema,
        _meta,
      })),
    ).toEqual([
      { name: "echo", inputSchema: toolInputSchema(parameters), _meta: undefined },
      { name: "finish", inputSchema: toolInputSchema(), _meta: { "anthropic/alwaysLoad": true } },
    ]);
    const args = { value: { nested: ["value", null] }, allowed: true };
    expect(await client.callTool({ name: "echo", arguments: args })).toMatchObject({
      content: [{ type: "text", text: JSON.stringify(args.value) }],
    });
    expect(
      await client.callTool({ name: "echo", arguments: { ...args, allowed: false } }),
    ).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("Not allowed") }] });
    expect(await client.callTool({ name: "finish", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "Done" }],
      _meta: { "claude/endTurn": true },
    });
  } finally {
    await client.close();
    await server.instance.close();
  }
});
