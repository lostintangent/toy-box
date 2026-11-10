import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionConfiguration } from "../provider";

/** An in-process SDK server, using the app's Zod version to preserve full tool schemas. */
export function createClaudeTools(
  definitions: SessionConfiguration["tools"],
): McpSdkServerConfigWithInstance {
  const instance = new McpServer({ name: "toy_box", version: "1" });
  for (const definition of definitions)
    instance.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.parameters ?? z.object({}),
        ...(definition.alwaysLoad ? { _meta: { "anthropic/alwaysLoad": true } } : {}),
      },
      async (args) => ({
        content: [{ type: "text", text: await definition.handler(args) }],
        ...(definition.isTerminal ? { _meta: { "claude/endTurn": true } } : {}),
      }),
    );
  return { type: "sdk", name: "toy_box", instance };
}
