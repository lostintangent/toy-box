import {
  getSessionProvider,
  listModels,
  listSessions as listNativeSessions,
  sessionProviders,
} from "@providers/server";
import type { SessionMetadata, SessionType } from "../model";
import type { ModelConfiguration } from "../model/modelConfiguration";
import { normalizeModelConfiguration } from "../model/modelConfiguration";
import type {
  SessionIdentity,
  SessionConfiguration,
  SessionProvider,
} from "@providers/server/provider";
import { bindProviderSession, readProviderBinding, readProviderBindings } from "./state/sessions";
import { buildSessionSystemPrompt } from "./instructions";
import { getSessionSkillDirectories } from "./bundledSkills";
import { ensureSessionFiles, sessionAttachmentsDirectory } from "./artifacts";
import { sharedSet } from "@/shared/server/processState";

// A native history can become discoverable before its create request returns.
// Only unbound histories from that provider need to wait for their public IDs.
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

/** Imported native sessions use the same namespaced identity for every provider. */
export async function resolveSessionIdentity(sessionId: string): Promise<SessionIdentity> {
  const binding = await readProviderBinding(sessionId);
  if (binding) return binding;
  for (const provider of sessionProviders) {
    if (sessionId.startsWith(`${provider.id}:`)) {
      return {
        sessionId,
        providerId: provider.id,
        nativeId: sessionId.slice(provider.id.length + 1),
      };
    }
  }
  throw new Error(`Session not found: ${sessionId}.`);
}

export async function listSessions(): Promise<SessionMetadata[]> {
  const bindingsBefore = await readProviderBindings();
  const sessions = await listNativeSessions();
  // Native discovery can overlap creation or deletion. Keep public identity
  // from either side so managed sessions never reappear as imported histories.
  const bindingsAfter = await readProviderBindings();
  const byNative = new Map(
    [...bindingsBefore, ...bindingsAfter].map((binding) => [
      `${binding.providerId}:${binding.nativeId}`,
      binding.sessionId,
    ]),
  );
  const unboundProviders = new Set(
    sessions
      .filter((session) => !byNative.has(`${session.provider}:${session.sessionId}`))
      .map((session) => session.provider),
  );
  const pending = [...pendingCreations].filter((creation) =>
    unboundProviders.has(creation.providerId),
  );
  if (pending.length) {
    await Promise.allSettled(pending.map((creation) => creation.completion));
    for (const binding of await readProviderBindings())
      byNative.set(`${binding.providerId}:${binding.nativeId}`, binding.sessionId);
  }
  return sessions.map((session) => ({
    ...session,
    sessionId:
      byNative.get(`${session.provider}:${session.sessionId}`) ??
      `${session.provider}:${session.sessionId}`,
  }));
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
    attachmentsDirectory: sessionAttachmentsDirectory(sessionId),
  };
}

export async function createSession(
  sessionId: string,
  options: ConfigurationOptions & { name?: string },
) {
  if (await readProviderBinding(sessionId)) throw new Error("Session already exists.");
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
  const connection = await provider.create(sessionId, configuration);
  try {
    if (name) await connection.rename(name);
    await bindProviderSession(connection.identity);
  } catch (error) {
    await connection.disconnect().catch(console.error);
    await provider.delete(connection.identity.nativeId).catch(console.error);
    throw error;
  }
  return connection;
}

export async function resumeSession(sessionId: string, options: ConfigurationOptions) {
  const identity = await resolveSessionIdentity(sessionId);
  if (options.model && options.model.provider !== identity.providerId) {
    throw new Error(
      "An existing session cannot change providers. Start a new session to use that model.",
    );
  }
  await ensureSessionFiles(sessionId);
  return getSessionProvider(identity.providerId).resume(
    identity,
    configuration(sessionId, options),
  );
}

export async function deleteSession(sessionId: string) {
  const identity = await resolveSessionIdentity(sessionId);
  await getSessionProvider(identity.providerId).delete(identity.nativeId);
}

export async function getSessionDirectory(sessionId: string) {
  const identity = await resolveSessionIdentity(sessionId);
  return getSessionProvider(identity.providerId).readDirectory(identity.nativeId);
}

export async function readSessionHistory(sessionId: string) {
  const identity = await resolveSessionIdentity(sessionId);
  return getSessionProvider(identity.providerId).readHistory(identity);
}

export async function isHistoryCurrent(sessionId: string, capturedAt: number) {
  const identity = await resolveSessionIdentity(sessionId);
  return getSessionProvider(identity.providerId).isHistoryCurrent(identity.nativeId, capturedAt);
}
