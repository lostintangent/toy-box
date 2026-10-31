import { describe, expect, test } from "bun:test";
import { workspaceActionSchema } from "./actions";

describe("workspace action protocol", () => {
  test("keeps inbox mutations server-authoritative", () => {
    expect(
      workspaceActionSchema.safeParse({ type: "inbox.entry.deleted", entryId: "entry-1" }).success,
    ).toBe(false);
    expect(workspaceActionSchema.safeParse({ type: "inbox.changed" }).success).toBe(false);
  });
});
