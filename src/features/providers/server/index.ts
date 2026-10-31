import type { Session } from "@sessions/model";
import {
  normalizeModelConfiguration,
  type ModelInfo,
  type ProviderCatalog,
  type SessionProviderStatus,
} from "@providers/model";
import { getSettings } from "@workspace/server/state/settings";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import type { SessionProvider } from "./provider";
import * as cli from "./cli";
import { copilotProvider } from "./copilot/provider";
import { codexProvider } from "./codex/provider";
import { claudeProvider } from "./claude/provider";

export const sessionProviders: readonly SessionProvider[] = [
  copilotProvider,
  codexProvider,
  claudeProvider,
];

type Discovery = { status: SessionProviderStatus; models: ModelInfo[] };
const discoveryByProvider = sharedMap<Promise<Discovery>>("provider-discovery");

export function getSessionProvider(id: string): SessionProvider {
  const provider = sessionProviders.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown session provider: ${id}.`);
  return provider;
}

export async function getProviderCatalog(): Promise<ProviderCatalog> {
  const enabled = await enabledProviders();
  // Disabled providers aren't started just to check their account.
  const discoveries = await Promise.all(
    sessionProviders.map(async (provider) =>
      enabled.includes(provider) ? discover(provider) : undefined,
    ),
  );
  return {
    providers: sessionProviders.map(({ id, name }, index) => ({
      id,
      name,
      status: discoveries[index]?.status ?? (cli.isInstalled(id) ? "ready" : "unavailable"),
    })),
    models: discoveries.flatMap((discovery) => discovery?.models ?? []),
  };
}

export async function getModelChoices(provider?: string) {
  const [{ models }, { defaultModel }] = await Promise.all([getProviderCatalog(), getSettings()]);
  const workspaceDefault =
    models.length > 0 ? normalizeModelConfiguration(models, defaultModel) : null;
  return {
    models: provider ? models.filter((model) => model.provider === provider) : models,
    defaultModel: !provider || workspaceDefault?.provider === provider ? workspaceDefault : null,
  };
}

export async function listModels(): Promise<ModelInfo[]> {
  return (await getProviderCatalog()).models;
}

export async function updateProvider(providerId: string) {
  const { id } = getSessionProvider(providerId);
  const result = await cli.updateProvider(id);
  // Refresh even when unchanged: the CLI may have been upgraded outside Toy Box.
  discoveryByProvider.delete(id);
  broadcast({ type: "providers.changed" });
  return result;
}

/** Failed discovery leaves the provider ready without models until a later request retries it. */
function discover(provider: SessionProvider): Promise<Discovery> {
  const cached = discoveryByProvider.get(provider.id);
  if (cached) return cached;

  const discovery = (async (): Promise<Discovery> => {
    if (!(await provider.isSignedIn())) return { status: "signedOut", models: [] };
    const models = await provider.listModels();
    return {
      status: "ready",
      models: models.map((model) => ({ ...model, providerName: provider.name })),
    };
  })().catch((error): Discovery => {
    discoveryByProvider.delete(provider.id);
    console.error(`Unable to discover ${provider.name}:`, error);
    return { status: "ready", models: [] };
  });
  discoveryByProvider.set(provider.id, discovery);
  return discovery;
}

/** Catalog IDs belong to the native providers; Sessions maps them to public IDs. */
export function listSessions(): Promise<Session[]> {
  return collectAvailable(async (provider) =>
    (await provider.listSessions()).map((session) => ({
      ...session,
      provider: { id: provider.id },
    })),
  );
}

export async function stopProviders(): Promise<void> {
  discoveryByProvider.clear();
  await Promise.allSettled(sessionProviders.map((provider) => provider.stop()));
}

/** Installed providers the owner hasn't disabled. */
async function enabledProviders(): Promise<SessionProvider[]> {
  const { disabledProviders } = await getSettings();
  return sessionProviders.filter(
    (provider) => cli.isInstalled(provider.id) && !disabledProviders.includes(provider.id),
  );
}

async function collectAvailable<T>(
  read: (provider: SessionProvider) => Promise<T[]>,
): Promise<T[]> {
  const providers = await enabledProviders();
  const results = await Promise.allSettled(providers.map(read));
  const values: T[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      values.push(...result.value);
    } else console.error(`Unable to discover ${providers[index]!.name}:`, result.reason);
  }
  return values;
}
