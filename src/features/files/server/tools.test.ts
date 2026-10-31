import { expect, test } from "bun:test";
import { fileTools } from "./tools";

test.each(fileTools)("$name accepts only an absolute path", (tool) => {
  expect(tool.parameters!.parse({ path: " /repo/src/foo.ts " })).toEqual({
    path: "/repo/src/foo.ts",
  });
  expect(() => tool.parameters!.parse({ path: "src/foo.ts" })).toThrow("absolute");
});
