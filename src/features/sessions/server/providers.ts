import {
  getSessionProvider,
  listModels,
  listSessions as listNativeSessions,
  sessionProviders,
} from "@providers/server";
import type { Session, SessionType } from "../model";
import { normalizeModelConfiguration, type ModelConfiguration } from "@providers/model";
import type { SessionConfiguration, SessionProvider } from "@providers/server/provider";
import { setSessionProvider, readSession, readSessions } from "./state/sessions";
import { buildSessionSystemPrompt } from "./instructions";
import { getSessionSkillDirectories } from "./bundledSkills";
import { ensureSessionFiles } from "./artifacts";
import { sharedSet } from "@/shared/server/processState";

// A native history can become discoverable before its create request returns.
// Only unknown histories from that provider need to wait for their public IDs.
const pendingCreations = sharedSet<{
  providerId: string;
  completion: ReturnType<SessionProvider["create"]>;
}>("provider-session-creations");

type ConfigurationOptions = Pick<SessionConfiguration, "model" | "directory" | "disableMemory"> & {
  sessionType: SessionType;
  tools?: SessionConfiguration["tools"];
  artifactPath?: string;
  additionalInstructions?: string;
};

/** External histories have stable public addresses without claiming a local record. */
export async function resolveSession(
  id: string,
): Promise<Pick<Session, "id"> & Required<Pick<Session, "provider">>> {
  const session = await readSession(id);
  if (session?.provider) return { id, provider: session.provider };
  for (const provider of sessionProviders) {
    if (id.startsWith(`${provider.id}:`)) {
      return { id, provider: { id: provider.id, sessionId: id.slice(provider.id.length + 1) } };
    }
  }
  throw new Error(`Session not found: ${id}.`);
}

export async function listSessions(): Promise<Session[]> {
  const before = await readSessions();
  const nativeSessions = await listNativeSessions();
  // Preserve public IDs across native discovery overlapping creation or deletion.
  let records = await readSessions();
  const byNative = new Map(
    [...before, ...records]
      .filter((session) => session.provider)
      .map((session) => [
        `${session.provider!.id}:${session.provider!.sessionId ?? session.id}`,
        session,
      ]),
  );
  const unknownProviders = new Set(
    nativeSessions
      .filter((session) => !byNative.has(`${session.provider!.id}:${session.id}`))
      .map((session) => session.provider!.id),
  );
  const pending = [...pendingCreations].filter((creation) =>
    unknownProviders.has(creation.providerId),
  );
  if (pending.length) {
    await Promise.allSettled(pending.map((creation) => creation.completion));
    records = await readSessions();
    for (const session of records) {
      if (session.provider)
        byNative.set(`${session.provider.id}:${session.provider.sessionId ?? session.id}`, session);
    }
  }
  return [
    ...records.filter((session) => !session.provider),
    ...nativeSessions.map((native) => {
      const record = byNative.get(`${native.provider!.id}:${native.id}`);
      const id = record?.id ?? `${native.provider!.id}:${native.id}`;
      return {
        ...native,
        id,
        createdAt: record?.createdAt ?? native.createdAt,
        provider: {
          id: native.provider!.id,
          ...(native.id !== id ? { sessionId: native.id } : {}),
        },
        ...(record?.artifactPath ? { artifactPath: record.artifactPath } : {}),
      };
    }),
  ];
}

export async function listSkills(
  directory?: string,
  sessionType: SessionType = "standard",
  providerId?: string,
) {
  const provider = getSessionProvider(providerId ?? (await defaultModel()).provider);
  return provider.listSkills(directory, getSessionSkillDirectories(sessionType));
}

async function defaultModel(): Promise<ModelConfiguration> {
  const stored = (await (await import("@workspace/server/state/settings")).getSettings())
    .defaultModel;
  const model = normalizeModelConfiguration(await listModels(), stored);
  if (!model) throw new Error("No session models are available. Check your provider login.");
  return model;
}

function configuration(sessionId: string, options: ConfigurationOptions): SessionConfiguration {
  return {
    model: options.model,
    directory: options.directory,
    disableMemory: options.disableMemory,
    allowUserQuestions: options.sessionType === "standard" || options.sessionType === "hyper",
    tools: options.tools ?? [],
    instructions: buildSessionSystemPrompt(sessionId, options),
    skillDirectories: getSessionSkillDirectories(options.sessionType),
  };
}

export async function createSession(
  sessionId: string,
  options: ConfigurationOptions & { name?: string },
) {
  if ((await readSession(sessionId))?.provider) throw new Error("Session already exists.");
  const model = options.model ?? (await defaultModel());
  const provider = getSessionProvider(model.provider);
  const creation = {
    providerId: provider.id,
    completion: createNativeSession(
      provider,
      sessionId,
      configuration(sessionId, { ...options, model }),
      options.name,
    ),
  };
  pendingCreations.add(creation);
  try {
    return await creation.completion;
  } finally {
    pendingCreations.delete(creation);
  }
}

async function createNativeSession(
  provider: SessionProvider,
  sessionId: string,
  configuration: SessionConfiguration,
  name?: string,
) {
  const connection = await provider.create(sessionId, { ...configuration, name });
  try {
    await setSessionProvider(sessionId, connection.provider);
  } catch (error) {
    await connection.disconnect().catch(console.error);
    await provider.delete(connection.provider.sessionId ?? sessionId).catch(console.error);
    throw error;
  }
  return connection;
}

export async function resumeSession(sessionId: string, options: ConfigurationOptions) {
  const session = await resolveSession(sessionId);
  if (options.model && options.model.provider !== session.provider.id) {
    throw new Error(
      "An existing session cannot change providers. Start a new session to use that model.",
    );
  }
  await ensureSessionFiles(sessionId);
  return getSessionProvider(session.provider.id).resume(session, configuration(sessionId, options));
}

export async function deleteSession(sessionId: string) {
  const session = await resolveSession(sessionId);
  await getSessionProvider(session.provider.id).delete(session.provider.sessionId ?? session.id);
}

export async function getSessionDirectory(sessionId: string) {
  const session = await resolveSession(sessionId);
  return getSessionProvider(session.provider.id).readDirectory(
    session.provider.sessionId ?? session.id,
  );
}

export async function readSessionHistory(sessionId: string) {
  const session = await resolveSession(sessionId);
  return getSessionProvider(session.provider.id).readHistory(session);
}

export async function isHistoryCurrent(sessionId: string, capturedAt: number) {
  const session = await resolveSession(sessionId);
  return getSessionProvider(session.provider.id).isHistoryCurrent(
    session.provider.sessionId ?? session.id,
    capturedAt,
  );
}
