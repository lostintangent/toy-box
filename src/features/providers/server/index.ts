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

/** Reads what discovery knows now, so a provider still being discovered is ready without models. */
export async function getProviderCatalog(): Promise<ProviderCatalog> {
  const enabled = await enabledProviders();
  // Disabled providers aren't started just to check their account.
  const discoveries = sessionProviders.map((provider) => {
    const discovery = enabled.includes(provider) ? Bun.peek(discover(provider)) : undefined;
    return discovery instanceof Promise ? undefined : discovery;
  });
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
  const [models, { defaultModel }] = await Promise.all([listModels(), getSettings()]);
  const workspaceDefault =
    models.length > 0 ? normalizeModelConfiguration(models, defaultModel) : null;
  return {
    models: provider ? models.filter((model) => model.provider === provider) : models,
    defaultModel: !provider || workspaceDefault?.provider === provider ? workspaceDefault : null,
  };
}

export async function listModels(): Promise<ModelInfo[]> {
  const discoveries = await Promise.all((await enabledProviders()).map(discover));
  return discoveries.flatMap((discovery) => discovery.models);
}

export async function updateProvider(providerId: string) {
  const { id } = getSessionProvider(providerId);
  const result = await cli.updateProvider(id);
  // Refresh even when unchanged: the CLI may have been upgraded outside Toy Box. Waiting makes
  // discovery's broadcast the one hint, so no client refetches mid-rediscovery.
  discoveryByProvider.delete(id);
  await listModels();
  return result;
}

/** Failed discovery leaves the provider ready without models until a later request retries it. */
function discover(provider: SessionProvider): Promise<Discovery> {
  const cached = discoveryByProvider.get(provider.id);
  if (cached) return cached;

  const discovery = (async (): Promise<Discovery> => {
    const signedIn = await provider.isSignedIn();
    const models = signedIn ? await provider.listModels() : [];
    // Catalog reads don't wait, so this is their hint. A failure stays quiet, since its hint would
    // send every client into a refetch and retry loop.
    broadcast({ type: "providers.changed" });
    return {
      status: signedIn ? "ready" : "signedOut",
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

/** Native sessions keep their native IDs; Sessions maps them to public IDs. */
export function listSessions(limit?: number) {
  return collectAvailable(async (provider) =>
    (await provider.listSessions(limit)).map((session) => ({
      ...session,
      providerId: provider.id,
    })),
  );
}

/** A disabled provider or failed read has no session to report. */
export async function readSession(providerId: string, nativeId: string) {
  const provider = (await enabledProviders()).find(({ id }) => id === providerId);
  const session = await provider?.readSession(nativeId).catch((error) => {
    console.error(`Unable to read ${providerId} session ${nativeId}:`, error);
    return undefined;
  });
  return session && { ...session, providerId };
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
