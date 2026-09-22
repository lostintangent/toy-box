import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as database from "@/server/database";
import { copilotProvider } from "@providers/server/copilot/provider";
import { codexProvider } from "@providers/server/codex/provider";
import { sessionProviders, getSessionProvider } from "@providers/server";
import * as cli from "@providers/server/cli";
import {
  createSession,
  listSkills,
  listSessions,
  resolveSession,
  resumeSession,
} from "./providers";
import {
  setSessionProvider,
  deleteSessionRecord,
  readSession,
  insertSession,
} from "./state/sessions";
import type { SessionConnection } from "@providers/server/provider";
import { deleteSessionFiles } from "./artifacts";

async function setup() {
  const db = await database.createTestDatabase();
  spyOn(database, "getStateDatabase").mockResolvedValue(db);
  spyOn(cli, "isInstalled").mockReturnValue(false);
  onTestFinished(async () => {
    mock.restore();
    await db.close();
  });
}

test.each(sessionProviders.map((provider) => provider.id))(
  "%s receives session-owned skills and interactive policy on creation and resume",
  async (providerId) => {
    await setup();
    const provider = getSessionProvider(providerId);
    const sessionId = `toy-box-test-${crypto.randomUUID()}`;
    onTestFinished(() => deleteSessionFiles(sessionId));
    const session = { id: sessionId, provider: { id: providerId, sessionId: "native" } };
    const connection = { provider: session.provider } as SessionConnection;
    const create = spyOn(provider, "create").mockResolvedValue(connection);
    const resume = spyOn(provider, "resume").mockResolvedValue(connection);
    const skills = spyOn(provider, "listSkills").mockResolvedValue([]);
    const result = await createSession(sessionId, {
      sessionType: "hyper",
      directory: "/tmp",
      name: "Named session",
      model: { provider: providerId, name: "model" },
      additionalInstructions: "Follow the host's instructions.",
    });
    expect(result).toBe(connection);
    const configuration = create.mock.calls[0]![1];
    expect(configuration.name).toBe("Named session");
    expect(configuration.allowUserQuestions).toBe(true);
    expect(configuration.instructions).toContain("Follow the host's instructions.");
    expect(
      configuration.skillDirectories.some((path) => path.endsWith("create-toy-box-editor")),
    ).toBe(true);
    await listSkills("/tmp", "hyper", providerId);
    expect(skills).toHaveBeenCalledWith("/tmp", configuration.skillDirectories);

    await resumeSession(sessionId, { sessionType: "worker", directory: "/tmp" });
    const resumed = resume.mock.calls[0]![1];
    expect(resumed.allowUserQuestions).toBe(false);
    expect(resumed.skillDirectories.some((path) => path.endsWith("create-toy-box-editor"))).toBe(
      false,
    );
  },
);

test("public IDs keep their provider and discovered native sessions resolve back to them", async () => {
  await setup();
  const session = {
    id: "11111111-1111-4111-8111-111111111111",
    provider: { id: "codex", sessionId: "native-uuid" },
  };
  const draft = {
    id: session.id,
    artifactPath: "report.md",
    createdAt: new Date(42),
    updatedAt: new Date(42),
  };
  await insertSession(draft);
  const create = spyOn(codexProvider, "create").mockImplementation(async () => {
    expect(await readSession(session.id)).toEqual(draft);
    return { provider: session.provider } as SessionConnection;
  });
  await createSession(session.id, {
    directory: "/tmp",
    sessionType: "standard",
    model: { name: "model", provider: "codex" },
    name: "Prepared session",
  });
  expect(create.mock.calls[0]![1].name).toBe("Prepared session");
  expect((await readSession(session.id))?.provider).toEqual(session.provider);
  expect(await resolveSession(session.id)).toEqual(session);
  await expect(
    setSessionProvider(session.id, { ...session.provider, sessionId: "different" }),
  ).rejects.toThrow("different provider history");
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  spyOn(codexProvider, "listSessions").mockResolvedValue(
    ["native-uuid", "external"].map((id) => ({
      id,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  );
  expect((await listSessions()).map((session) => session.id)).toEqual([
    session.id,
    "codex:external",
  ]);
  expect(await resolveSession("codex:external")).toEqual({
    id: "codex:external",
    provider: { id: "codex", sessionId: "external" },
  });
});

test("failed native preparation leaves the session a draft for retry", async () => {
  await setup();
  const session = { id: "retry", provider: { id: "codex", sessionId: "native" } };
  const draft = {
    id: session.id,
    artifactPath: "report.md",
    createdAt: new Date(42),
    updatedAt: new Date(42),
  };
  await insertSession(draft);
  spyOn(codexProvider, "create")
    .mockRejectedValueOnce(new Error("Creation failed"))
    .mockResolvedValue({ provider: session.provider } as SessionConnection);
  const options = {
    directory: "/tmp",
    sessionType: "standard" as const,
    model: { name: "model", provider: "codex" },
    name: "Prepared session",
  };
  await expect(createSession(session.id, options)).rejects.toThrow("Creation failed");
  expect(await readSession(session.id)).toEqual(draft);

  await createSession(session.id, options);
  expect((await readSession(session.id))?.provider).toEqual(session.provider);
  expect(await resolveSession(session.id)).toEqual(session);
});

test("imported identities are uniform and existing sessions cannot change providers", async () => {
  await setup();
  await expect(resolveSession("unknown")).rejects.toThrow("Session not found");
  expect(await resolveSession("copilot:external")).toEqual({
    id: "copilot:external",
    provider: { id: "copilot", sessionId: "external" },
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
] as const)("%s discovery preserves public ID during concurrent %s", async (providerId, change) => {
  await setup();
  const provider = providerId === "copilot" ? copilotProvider : codexProvider;
  spyOn(cli, "isInstalled").mockImplementation((id) => id === providerId);
  const session = {
    id: "managed-session",
    provider: { id: providerId, sessionId: "native-session" },
  };
  if (change === "deletion") await setSessionProvider(session.id, session.provider);
  spyOn(provider, "listSessions").mockImplementation(async () => {
    if (change === "creation") await setSessionProvider(session.id, session.provider);
    else await deleteSessionRecord(session.id);
    return [
      {
        id: session.provider.sessionId,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        title: "Managed session",
      },
    ];
  });

  expect((await listSessions()).map(({ id }) => id)).toEqual([session.id]);
});

test.each(["copilot", "codex"] as const)(
  "%s discovery waits for a discoverable native history to acquire its public ID",
  async (providerId) => {
    await setup();
    const provider = providerId === "copilot" ? copilotProvider : codexProvider;
    spyOn(cli, "isInstalled").mockImplementation((id) => id === providerId);
    const session = {
      id: "managed-session",
      provider: { id: providerId, sessionId: "native-session" },
    };
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
          id: session.provider.sessionId,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ];
    });
    const creation = createSession(session.id, {
      directory: "/tmp",
      sessionType: "worker",
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
      created.resolve({ provider: session.provider } as SessionConnection);
      await creation;
    }
    expect((await catalog).map(({ id }) => id)).toEqual([session.id]);
  },
);

test.each(["known session", "other provider"] as const)(
  "%s catalog entries do not wait for unrelated native creation",
  async (kind) => {
    await setup();
    spyOn(cli, "isInstalled").mockImplementation((id) => id === "copilot" || id === "codex");
    const session = { id: "creating", provider: { id: "codex", sessionId: "new-native" } };
    const created = Promise.withResolvers<Awaited<ReturnType<typeof codexProvider.create>>>();
    const creating = Promise.withResolvers<void>();
    spyOn(codexProvider, "create").mockImplementation(() => {
      creating.resolve();
      return created.promise;
    });
    const existing = {
      id: "known-native",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    if (kind === "known session")
      await setSessionProvider("known-public", { id: "codex", sessionId: existing.id });
    spyOn(copilotProvider, "listSessions").mockResolvedValue(
      kind === "other provider" ? [existing] : [],
    );
    spyOn(codexProvider, "listSessions").mockResolvedValue(
      kind === "known session" ? [existing] : [],
    );
    const creation = createSession(session.id, {
      directory: "/tmp",
      sessionType: "worker",
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
      expect(catalog.map(({ id }) => id)).toEqual([
        kind === "known session" ? "known-public" : "copilot:known-native",
      ]);
    } finally {
      created.resolve({ provider: session.provider } as SessionConnection);
      await creation;
    }
  },
);
