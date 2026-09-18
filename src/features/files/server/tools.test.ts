import { expect, test } from "bun:test";
import type { ToolInvocation } from "@sessions/server/tools/definition";
import { fileTools } from "./tools";

function invocation(): ToolInvocation {
  return { sessionId: "toy-box-session", toolCallId: "call", toolName: "open_file", arguments: {} };
}

test.each(fileTools)("$name validates an absolute path and acknowledges success", (tool) => {
  const args = tool.parameters!.parse({ path: " /repo/src/foo.ts " });
  expect(args).toEqual({ path: "/repo/src/foo.ts" });
  expect(tool.handler(args, invocation())).toBe(
    tool.name === "open_file" ? "Opened file." : "Closed file.",
  );
  expect(() => tool.parameters!.parse({ path: "src/foo.ts" })).toThrow("absolute");
});
