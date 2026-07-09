import { describe, expect, test } from "bun:test";
import { workspaceActionSchema } from "./actions";

describe("workspace action protocol", () => {
  test("creates a normal or hyper draft with one action", () => {
    const draft = {
      type: "session.draft.created",
      sessionId: "toy-box-draft",
      createdAt: 1,
    } as const;

    expect(workspaceActionSchema.safeParse(draft).success).toBe(true);
    expect(workspaceActionSchema.safeParse({ ...draft, hyper: true }).success).toBe(true);
    expect(
      workspaceActionSchema.safeParse({ type: "session.hyper.created", sessionId: draft.sessionId })
        .success,
    ).toBe(false);
  });

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
