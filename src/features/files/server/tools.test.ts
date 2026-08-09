import { expect, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import { fileTools } from "./tools";

const [openFile, closeFile] = fileTools;

function invocation(): ToolInvocation {
  return { sessionId: "toy-box-session", toolCallId: "call", toolName: "open_file", arguments: {} };
}

test("open_file resolves an absolute path to a machine workspace file", () => {
  const result = openFile.handler?.({ path: "/repo/src/foo.ts" }, invocation());
  expect(JSON.parse(String(result))).toEqual({ type: "machine", path: "/repo/src/foo.ts" });
});

test("close_file resolves an absolute path to a machine workspace file", () => {
  const result = closeFile.handler?.({ path: "/repo/src/foo.ts" }, invocation());
  expect(JSON.parse(String(result))).toEqual({ type: "machine", path: "/repo/src/foo.ts" });
});

test("open_file rejects a relative path", () => {
  expect(() => openFile.handler?.({ path: "src/foo.ts" }, invocation())).toThrow("absolute");
});
