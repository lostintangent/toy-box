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

const { deleteSessionRecord, insertSession, setSessionProvider, readSession, readSessions } =
  await import("./sessions");

describe("session database", () => {
  async function setup() {
    currentDb = await createTestDatabase();
    onTestFinished(async () => {
      await currentDb?.close();
      currentDb = undefined;
    });
    return currentDb;
  }

  test("starting a session keeps its ID, creation time and initial artifact", async () => {
    await setup();
    const plain = { id: "plain", createdAt: new Date(41) };
    const artifact = { id: "artifact", artifactPath: "document.md", createdAt: new Date(42) };
    await insertSession(plain);
    await insertSession(artifact);

    expect(await readSession(plain.id)).toEqual({ ...plain, updatedAt: plain.createdAt });
    expect((await readSessions()).every((session) => !session.provider)).toBe(true);
    const provider = { id: "codex", sessionId: "native-artifact" };
    await setSessionProvider(artifact.id, provider);
    expect(await readSession(artifact.id)).toEqual({
      ...artifact,
      updatedAt: artifact.createdAt,
      provider,
    });
    expect(
      (await readSessions()).filter((session) => !session.provider).map(({ id }) => id),
    ).toEqual([plain.id]);
    await expect(insertSession(artifact)).rejects.toThrow();
    await deleteSessionRecord(plain.id);
    expect((await readSessions()).map(({ id }) => id)).toEqual([artifact.id]);
  });

  test("native history is exclusive until deletion releases the canonical ID", async () => {
    const db = await setup();
    const id = "automation";
    await setSessionProvider(id, { id: "copilot", sessionId: id });
    await setSessionProvider(id, { id: "copilot" });
    const [row] = await db`SELECT native_id FROM sessions WHERE session_id = ${id}`;
    expect(row.native_id).toBeNull();
    expect((await readSession(id))?.provider).toEqual({ id: "copilot" });
    await expect(
      setSessionProvider(id, { id: "copilot", sessionId: "second-run" }),
    ).rejects.toThrow("different provider history");
    await expect(setSessionProvider("other", { id: "copilot", sessionId: id })).rejects.toThrow();
    expect(await readSessions()).toHaveLength(1);

    await deleteSessionRecord(id);
    expect(await readSession(id)).toBeUndefined();
    const provider = { id: "codex", sessionId: "second-run" };
    await setSessionProvider(id, provider);
    expect((await readSession(id))?.provider).toEqual(provider);
  });

  test("storage permits a canonical native ID but requires its provider", async () => {
    const db = await setup();
    const insert = async (provider: string | null, nativeId: string | null) => {
      await db`INSERT INTO sessions (session_id, provider_id, native_id, created_at)
        VALUES (${crypto.randomUUID()}, ${provider}, ${nativeId}, 1)`;
    };
    await insert("copilot", null);
    await expect(insert(null, "native")).rejects.toThrow();
  });
});
