import { describe, expect, test } from "bun:test";
import { workspaceActionSchema } from "./actions";

describe("workspace action protocol", () => {
  test("marks one session read", () => {
    expect(
      workspaceActionSchema.safeParse({ type: "session.read", sessionId: "session-1" }).success,
    ).toBe(true);
    expect(workspaceActionSchema.safeParse({ type: "session.read" }).success).toBe(false);
  });

  test("keeps inbox mutations server-authoritative", () => {
    expect(
      workspaceActionSchema.safeParse({ type: "inbox.entry.deleted", entryId: "entry-1" }).success,
    ).toBe(false);
    expect(
      workspaceActionSchema.safeParse({ type: "inbox.entry.upserted", entry: {} }).success,
    ).toBe(false);
  });
});
