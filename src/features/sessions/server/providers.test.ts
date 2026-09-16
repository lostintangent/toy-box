import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as database from "@/server/database";
import { copilotProvider } from "@providers/server/copilot/provider";
import { codexProvider } from "@providers/server/codex/provider";
import {
  createSession,
  listSkills,
  listSessions,
  resolveSessionIdentity,
  resumeSession,
} from "./providers";
import {
  bindProviderSession,
  deleteSessionRecord,
  getDraftSession,
  persistDraftSession,
} from "./state/sessions";
import type { SessionConnection } from "@providers/server/provider";
import { deleteSessionFiles, sessionAttachmentsDirectory } from "./artifacts";

async function setup() {
  const db = await database.createTestDatabase();
  spyOn(database, "getStateDatabase").mockResolvedValue(db);
  onTestFinished(async () => {
    mock.restore();
    await db.close();
  });
}

test.each(["copilot", "codex"] as const)(
  "%s receives session-owned skills, storage, and interactive policy on creation and resume",
  async (providerId) => {
    await setup();
    const provider = providerId === "copilot" ? copilotProvider : codexProvider;
    const sessionId = `toy-box-test-${crypto.randomUUID()}`;
    onTestFinished(() => deleteSessionFiles(sessionId));
    const identity = { sessionId, providerId, nativeId: "native" };
    const connection = { identity } as SessionConnection;
    const create = spyOn(provider, "create").mockResolvedValue(connection);
    const resume = spyOn(provider, "resume").mockResolvedValue(connection);
    const skills = spyOn(provider, "listSkills").mockResolvedValue([]);
    const result = await createSession(sessionId, {
      sessionType: "hyper",
      directory: "/tmp",
      model: { provider: providerId, name: "model" },
      additionalInstructions: "Follow the host's instructions.",
    });
    expect(result).toBe(connection);
    const configuration = create.mock.calls[0]![1];
    expect(configuration.allowUserQuestions).toBe(true);
    expect(configuration.instructions).toContain("Follow the host's instructions.");
    expect(configuration.attachmentsDirectory).toBe(sessionAttachmentsDirectory(sessionId));
    expect(
      configuration.skillDirectories.some((path) => path.endsWith("create-toy-box-editor")),
    ).toBe(true);
    await listSkills("/tmp", "hyper", providerId);
    expect(skills).toHaveBeenCalledWith("/tmp", configuration.skillDirectories);

    await resumeSession(sessionId, { sessionType: "agent", directory: "/tmp" });
    const resumed = resume.mock.calls[0]![1];
    expect(resumed.allowUserQuestions).toBe(false);
    expect(resumed.attachmentsDirectory).toBe(configuration.attachmentsDirectory);
    expect(resumed.skillDirectories.some((path) => path.endsWith("create-toy-box-editor"))).toBe(
      false,
    );
  },
);

test("public IDs bind once and discovered native sessions resolve back to them", async () => {
  await setup();
  const identity = { sessionId: "toy-box-reserved", providerId: "codex", nativeId: "native-uuid" };
  const draft = { sessionId: identity.sessionId, artifactPath: "report.md", createdAt: 42 };
  await persistDraftSession(draft);
  const rename = mock(async () => {
    expect(await getDraftSession(identity.sessionId)).toEqual(draft);
    return true;
  });
  spyOn(codexProvider, "create").mockResolvedValue({
    identity,
    rename,
  } as unknown as SessionConnection);
  await createSession(identity.sessionId, {
    directory: "/tmp",
    sessionType: "standard",
    model: { name: "model", provider: "codex" },
    name: "Prepared session",
  });
  expect(rename).toHaveBeenCalledWith("Prepared session");
  expect(await getDraftSession(identity.sessionId)).toBeNull();
  expect(await resolveSessionIdentity(identity.sessionId)).toEqual(identity);
  await expect(bindProviderSession({ ...identity, nativeId: "different" })).rejects.toThrow(
    "different provider history",
  );
  spyOn(copilotProvider, "isInstalled").mockReturnValue(false);
  spyOn(codexProvider, "isInstalled").mockReturnValue(true);
  spyOn(codexProvider, "listSessions").mockResolvedValue(
    ["native-uuid", "external"].map((sessionId) => ({
      sessionId,
      startTime: new Date(0),
      modifiedTime: new Date(0),
    })),
  );
  expect((await listSessions()).map((session) => session.sessionId)).toEqual([
    "toy-box-reserved",
    "codex:external",
  ]);
  expect(await resolveSessionIdentity("codex:external")).toEqual({
    sessionId: "codex:external",
    providerId: "codex",
    nativeId: "external",
  });
});

test("failed native preparation preserves the draft for retry", async () => {
  await setup();
  const identity = { sessionId: "toy-box-retry", providerId: "codex", nativeId: "native" };
  const draft = { sessionId: identity.sessionId, artifactPath: "report.md", createdAt: 42 };
  await persistDraftSession(draft);
  const rename = mock(async () => true).mockRejectedValueOnce(new Error("Naming failed"));
  const disconnect = mock(async () => {});
  spyOn(codexProvider, "create").mockResolvedValue({
    identity,
    rename,
    disconnect,
  } as unknown as SessionConnection);
  const remove = spyOn(codexProvider, "delete").mockResolvedValue(undefined);
  const options = {
    directory: "/tmp",
    sessionType: "standard" as const,
    model: { name: "model", provider: "codex" },
    name: "Prepared session",
  };
  await expect(createSession(identity.sessionId, options)).rejects.toThrow("Naming failed");
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith(identity.nativeId);
  expect(await getDraftSession(identity.sessionId)).toEqual(draft);

  await createSession(identity.sessionId, options);
  expect(await getDraftSession(identity.sessionId)).toBeNull();
  expect(await resolveSessionIdentity(identity.sessionId)).toEqual(identity);
});

test("imported identities are uniform and existing sessions cannot change providers", async () => {
  await setup();
  await expect(resolveSessionIdentity("unknown")).rejects.toThrow("Session not found");
  expect(await resolveSessionIdentity("copilot:external")).toEqual({
    sessionId: "copilot:external",
    providerId: "copilot",
    nativeId: "external",
  });
  await expect(
    resumeSession("copilot:external", {
      directory: "/tmp",
      sessionType: "standard",
      model: { name: "model", provider: "codex" },
    }),
  ).rejects.toThrow("cannot change providers");
});

test.each([
  ["copilot", "creation"],
  ["copilot", "deletion"],
  ["codex", "creation"],
  ["codex", "deletion"],
] as const)(
  "%s discovery preserves public identity during concurrent %s",
  async (providerId, change) => {
    await setup();
    const provider = providerId === "copilot" ? copilotProvider : codexProvider;
    spyOn(copilotProvider, "isInstalled").mockReturnValue(providerId === "copilot");
    spyOn(codexProvider, "isInstalled").mockReturnValue(providerId === "codex");
    const binding = { sessionId: "managed-session", providerId, nativeId: "native-session" };
    if (change === "deletion") await bindProviderSession(binding);
    spyOn(provider, "listSessions").mockImplementation(async () => {
      if (change === "creation") await bindProviderSession(binding);
      else await deleteSessionRecord(binding.sessionId);
      return [
        {
          sessionId: binding.nativeId,
          startTime: new Date(0),
          modifiedTime: new Date(0),
          title: "Managed session",
        },
      ];
    });

    expect((await listSessions()).map(({ sessionId }) => sessionId)).toEqual([binding.sessionId]);
  },
);

test.each(["copilot", "codex"] as const)(
  "%s discovery waits for a discoverable native history to acquire its public ID",
  async (providerId) => {
    await setup();
    const provider = providerId === "copilot" ? copilotProvider : codexProvider;
    spyOn(copilotProvider, "isInstalled").mockReturnValue(providerId === "copilot");
    spyOn(codexProvider, "isInstalled").mockReturnValue(providerId === "codex");
    const identity = { sessionId: "managed-session", providerId, nativeId: "native-session" };
    const creating = Promise.withResolvers<void>();
    const created = Promise.withResolvers<Awaited<ReturnType<typeof provider.create>>>();
    const discovered = Promise.withResolvers<void>();
    spyOn(provider, "create").mockImplementation(() => {
      creating.resolve();
      return created.promise;
    });
    spyOn(provider, "listSessions").mockImplementation(async () => {
      discovered.resolve();
      return [
        {
          sessionId: identity.nativeId,
          startTime: new Date(0),
          modifiedTime: new Date(0),
        },
      ];
    });
    const creation = createSession(identity.sessionId, {
      directory: "/tmp",
      sessionType: "agent",
      model: { provider: providerId, name: "model" },
    });
    await creating.promise;
    let published = false;
    const catalog = listSessions().then((sessions) => {
      published = true;
      return sessions;
    });
    try {
      await discovered.promise;
      await Bun.sleep(0);
      expect(published).toBe(false);
    } finally {
      created.resolve({ identity } as SessionConnection);
      await creation;
    }
    expect((await catalog).map(({ sessionId }) => sessionId)).toEqual([identity.sessionId]);
  },
);

test.each(["already bound", "other provider"] as const)(
  "%s catalog entries do not wait for unrelated native creation",
  async (kind) => {
    await setup();
    spyOn(copilotProvider, "isInstalled").mockReturnValue(true);
    spyOn(codexProvider, "isInstalled").mockReturnValue(true);
    const identity = { sessionId: "creating", providerId: "codex", nativeId: "new-native" };
    const created = Promise.withResolvers<Awaited<ReturnType<typeof codexProvider.create>>>();
    const creating = Promise.withResolvers<void>();
    spyOn(codexProvider, "create").mockImplementation(() => {
      creating.resolve();
      return created.promise;
    });
    const existing = {
      sessionId: "known-native",
      startTime: new Date(0),
      modifiedTime: new Date(0),
    };
    if (kind === "already bound")
      await bindProviderSession({
        sessionId: "known-public",
        providerId: "codex",
        nativeId: existing.sessionId,
      });
    spyOn(copilotProvider, "listSessions").mockResolvedValue(
      kind === "other provider" ? [existing] : [],
    );
    spyOn(codexProvider, "listSessions").mockResolvedValue(
      kind === "already bound" ? [existing] : [],
    );
    const creation = createSession(identity.sessionId, {
      directory: "/tmp",
      sessionType: "agent",
      model: { provider: "codex", name: "model" },
    });
    await creating.promise;
    try {
      const catalog = await Promise.race([
        listSessions(),
        Bun.sleep(1000).then(() => {
          throw new Error("Catalog blocked on an unrelated creation");
        }),
      ]);
      expect(catalog.map(({ sessionId }) => sessionId)).toEqual([
        kind === "already bound" ? "known-public" : "copilot:known-native",
      ]);
    } finally {
      created.resolve({ identity } as SessionConnection);
      await creation;
    }
  },
);
