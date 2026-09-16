import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const {
  deleteSessionRecord,
  getDraftSession,
  getDraftSessions,
  persistDraftSession,
  bindProviderSession,
  readProviderBinding,
  readProviderBindings,
} = await import("./sessions");

describe("session database", () => {
  async function setup() {
    currentDb = await createTestDatabase();
    onTestFinished(async () => {
      await currentDb?.close();
      currentDb = undefined;
    });
    return currentDb;
  }

  test("drafts retain their public identity when bound to native history", async () => {
    await setup();
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
    expect(await readProviderBindings()).toEqual([]);
    const identity = {
      sessionId: artifactDraft.sessionId,
      providerId: "codex",
      nativeId: "native-artifact-session",
    };
    await bindProviderSession(identity);
    expect(await getDraftSession(artifactDraft.sessionId)).toBeNull();
    expect(await getDraftSessions()).toEqual([plainDraft]);
    expect(await readProviderBinding(artifactDraft.sessionId)).toEqual(identity);
    expect(await readProviderBindings()).toEqual([identity]);
    await expect(persistDraftSession(artifactDraft)).rejects.toThrow();
    await deleteSessionRecord(plainDraft.sessionId);
    expect(await getDraftSessions()).toEqual([]);
  });

  test("native identity is exclusive until deletion releases the public ID", async () => {
    await setup();
    const identity = { sessionId: "automation", providerId: "copilot", nativeId: "first-run" };
    await bindProviderSession(identity);
    await bindProviderSession(identity);
    await expect(bindProviderSession({ ...identity, nativeId: "second-run" })).rejects.toThrow(
      "different provider history",
    );
    await expect(bindProviderSession({ ...identity, sessionId: "other" })).rejects.toThrow();
    expect(await readProviderBindings()).toEqual([identity]);

    await deleteSessionRecord(identity.sessionId);
    expect(await readProviderBinding(identity.sessionId)).toBeUndefined();
    const next = { ...identity, providerId: "codex", nativeId: "second-run" };
    await bindProviderSession(next);
    expect(await readProviderBindings()).toEqual([next]);
  });

  test("storage rejects partial provider bindings", async () => {
    const db = await setup();
    const insert = async (provider: string | null, nativeId: string | null) => {
      await db`INSERT INTO sessions (session_id, provider_id, native_id, created_at)
        VALUES (${crypto.randomUUID()}, ${provider}, ${nativeId}, 1)`;
    };
    await expect(insert("codex", null)).rejects.toThrow();
    await expect(insert(null, "native")).rejects.toThrow();
  });
});
