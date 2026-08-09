import { expect, test } from "bun:test";
import { resolveFileRequest } from "./request";

test("artifact requests reject a missing or out-of-sandbox path", async () => {
  const missing = await resolveFileRequest("toy-box-session", undefined);
  const traversal = await resolveFileRequest("toy-box-session", "../outside.md");

  expect("error" in missing && missing.error.status).toBe(400);
  expect("error" in traversal && traversal.error.status).toBe(403);
});
