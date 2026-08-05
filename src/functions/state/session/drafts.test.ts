import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "../database";

let currentDb: Bun.SQL | undefined;

mock.module("../database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { deleteDraftSession, getDraftSession, getDraftSessions, persistDraftSession } =
  await import("./drafts");

describe("draft session database", () => {
  test("round-trips optional artifact metadata and deletes a claim", async () => {
    currentDb = await createTestDatabase();
    onTestFinished(async () => {
      await currentDb?.close();
      currentDb = undefined;
    });
    const plainDraft = {
      sessionId: "toy-box-plain-draft",
      createdAt: 41,
    };
    const artifactDraft = {
      sessionId: "toy-box-artifact-draft",
      artifactPath: "document.md",
      createdAt: 42,
    };

    await persistDraftSession(plainDraft);
    await persistDraftSession(artifactDraft);

    expect(await getDraftSessions()).toEqual([artifactDraft, plainDraft]);
    expect(await getDraftSession(plainDraft.sessionId)).toEqual(plainDraft);
    await deleteDraftSession(artifactDraft.sessionId);
    expect(await getDraftSession(artifactDraft.sessionId)).toBeNull();
  });
});
