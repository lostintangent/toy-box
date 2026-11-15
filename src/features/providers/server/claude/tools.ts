import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolInputSchema, type SessionConfiguration } from "../provider";

/** An in-process SDK server that lists the same tool schemas as every provider. */
export function createClaudeTools(
  definitions: SessionConfiguration["tools"],
): McpSdkServerConfigWithInstance {
  const instance = new McpServer(
    { name: "toy_box", version: "1" },
    { capabilities: { tools: {} } },
  );
  instance.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: toolInputSchema(definition.parameters),
      ...(definition.alwaysLoad ? { _meta: { "anthropic/alwaysLoad": true } } : {}),
    })),
  }));
  instance.server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const definition = definitions.find(({ name }) => name === params.name)!;
    try {
      return {
        content: [{ type: "text", text: await definition.handler(params.arguments ?? {}) }],
        ...(definition.isTerminal ? { _meta: { "claude/endTurn": true } } : {}),
      };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text }], isError: true };
    }
  });
  return { type: "sdk", name: "toy_box", instance };
}
