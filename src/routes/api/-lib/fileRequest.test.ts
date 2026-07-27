import { expect, test } from "bun:test";
import { resolveFileRequest } from "./fileRequest";

test("artifact requests reject a missing or out-of-sandbox path", async () => {
  const missing = await resolveFileRequest("toy-box-session", undefined);
  const traversal = await resolveFileRequest("toy-box-session", "../outside.md");

  expect(missing.error?.status).toBe(400);
  expect(traversal.error?.status).toBe(403);
});
