import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeToolResult, type Tool } from "@sessions/server/tools/definition";

/** An in-process SDK server, using the app's Zod version to preserve full tool schemas. */
export function createClaudeTools(
  sessionId: string,
  definitions: Tool<any>[],
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
      async (args) => {
        const result = normalizeToolResult(await definition.handler(args, sessionId));
        return {
          ...result,
          ...(definition.isTerminal && !result.isError
            ? { _meta: { "claude/endTurn": true } }
            : {}),
        };
      },
    );
  return { type: "sdk", name: "toy_box", instance };
}
