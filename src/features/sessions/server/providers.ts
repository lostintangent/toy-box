import {
  getSessionProvider,
  listModels,
  listSessions as listNativeSessions,
  readSession as readNativeSession,
  sessionProviders,
} from "@providers/server";
import { homedir } from "node:os";
import type { Session, SessionContext, SessionType } from "../model";
import { normalizeModelConfiguration, type ModelConfiguration } from "@providers/model";
import {
  SessionNotFoundError,
  type NativeSession,
  type SessionConfiguration,
  type SessionProvider,
} from "@providers/server/provider";
import { setSessionProvider, readSession, readSessions } from "./state/sessions";
import { buildSessionSystemPrompt } from "./instructions";
import { getSessionSkillDirectories } from "./bundledSkills";
import { ensureSessionFiles } from "./artifacts";
import { toolResultText, type Tool } from "./tools/definition";
import { createToolCallProjector } from "./toolProjection";
import { sharedSet } from "@/shared/server/processState";

// A native history can become discoverable before its create request returns.
// Only unknown histories from that provider need to wait for their public IDs.
const pendingCreations = sharedSet<{
  providerId: string;
  completion: ReturnType<typeof createNativeSession>;
}>("provider-session-creations");

type ConfigurationOptions = Pick<SessionConfiguration, "model" | "directory" | "disableMemory"> & {
  sessionType: SessionType;
  tools?: Tool<any>[];
  artifactPath?: string;
  additionalInstructions?: string;
};

/** External histories have stable public addresses without claiming a local record. */
export async function resolveSession(id: string) {
  const address = nativeAddress(id, await readSession(id));
  if (!address) throw new SessionNotFoundError(id);
  return { provider: getSessionProvider(address.providerId), nativeId: address.nativeId };
}

export async function listSessions(limit?: number): Promise<Session[]> {
  const before = await readSessions();
  const nativeSessions = await listNativeSessions(limit);
  // Preserve public IDs across native discovery overlapping creation or deletion.
  let records = await readSessions();
  const byNative = new Map<string, Session>();
  const claim = (records: Session[]) => {
    for (const record of records) {
      const address = record.provider && nativeAddress(record.id, record);
      if (address) byNative.set(`${address.providerId}:${address.nativeId}`, record);
    }
  };
  claim([...before, ...records]);
  const unknownProviders = new Set(
    nativeSessions
      .filter((session) => !byNative.has(`${session.providerId}:${session.nativeId}`))
      .map((session) => session.providerId),
  );
  const pending = [...pendingCreations].filter((creation) =>
    unknownProviders.has(creation.providerId),
  );
  if (pending.length) {
    await Promise.allSettled(pending.map((creation) => creation.completion));
    records = await readSessions();
    claim(records);
  }
  return [
    ...records.filter((session) => !session.provider),
    ...nativeSessions.map((native) =>
      publicSession(native, byNative.get(`${native.providerId}:${native.nativeId}`)),
    ),
  ];
}

/** Read Sessions by public ID, omitting any without a provider history. */
export async function findSessions(sessionIds: string[]): Promise<Session[]> {
  const records = new Map((await readSessions()).map((record) => [record.id, record]));
  const sessions = await Promise.all(
    sessionIds.map(async (id) => {
      const record = records.get(id);
      const address = nativeAddress(id, record);
      const native = address && (await readNativeSession(address.providerId, address.nativeId));
      return native && publicSession(native, record);
    }),
  );
  return sessions.filter((session) => session !== undefined);
}

/** A record's native history, or the one an external ID names by provider prefix. */
function nativeAddress(id: string, record: Session | undefined) {
  if (record?.provider)
    return { providerId: record.provider.id, nativeId: record.provider.sessionId ?? id };
  const provider = sessionProviders.find((provider) => id.startsWith(`${provider.id}:`));
  return provider && { providerId: provider.id, nativeId: id.slice(provider.id.length + 1) };
}

function publicSession(
  { nativeId, providerId, ...native }: NativeSession & { providerId: string },
  record: Session | undefined,
): Session {
  const id = record?.id ?? `${providerId}:${nativeId}`;
  return {
    ...native,
    id,
    createdAt: record?.createdAt ?? native.createdAt,
    provider: { id: providerId, ...(nativeId !== id ? { sessionId: nativeId } : {}) },
    context: native.context && { ...native.context, directory: sessionDirectory(native.context) },
    ...(record?.artifactPath ? { artifactPath: record.artifactPath } : {}),
  };
}

/** Sessions start in the home directory when none was chosen, which is not a workspace. */
function sessionDirectory({ directory, gitRoot, repository }: SessionContext = {}) {
  return directory === homedir() && !gitRoot && !repository ? undefined : directory;
}

export async function listSkills(directory?: string, providerId?: string) {
  const provider = getSessionProvider(providerId ?? (await defaultModel()).provider);
  return provider.listSkills(directory, getSessionSkillDirectories());
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
    tools: (options.tools ?? []).map((tool) => ({
      ...tool,
      handler: async (args) =>
        toolResultText(
          await tool.handler(tool.parameters ? tool.parameters.parse(args) : args, sessionId),
        ),
    })),
    instructions: buildSessionSystemPrompt(sessionId, options),
    skillDirectories: getSessionSkillDirectories(),
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
    const association = await setSessionProvider(sessionId, {
      id: provider.id,
      sessionId: connection.nativeId,
    });
    return { connection, provider: association };
  } catch (error) {
    await connection.disconnect().catch(console.error);
    await provider.delete(connection.nativeId).catch(console.error);
    throw error;
  }
}

export async function resumeSession(sessionId: string, options: ConfigurationOptions) {
  const { provider, nativeId } = await resolveSession(sessionId);
  if (options.model && options.model.provider !== provider.id) {
    throw new Error(
      "An existing session cannot change providers. Start a new session to use that model.",
    );
  }
  await ensureSessionFiles(sessionId);
  return provider.resume(nativeId, configuration(sessionId, options));
}

export async function deleteSession(sessionId: string) {
  const { provider, nativeId } = await resolveSession(sessionId);
  await provider.delete(nativeId);
}

export async function getSessionDirectory(sessionId: string) {
  const { provider, nativeId } = await resolveSession(sessionId);
  return sessionDirectory((await provider.readSession(nativeId))?.context);
}

export async function readSessionHistory(sessionId: string) {
  const { provider, nativeId } = await resolveSession(sessionId);
  return (await provider.readHistory(nativeId)).flatMap(createToolCallProjector(sessionId));
}

export async function isHistoryCurrent(sessionId: string, capturedAt: number) {
  const { provider, nativeId } = await resolveSession(sessionId);
  return provider.isHistoryCurrent(nativeId, capturedAt);
}
