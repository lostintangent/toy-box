import type { Session } from "@sessions/model";
import type { ModelInfo, ProviderCatalog } from "@providers/model";
import { getSettings } from "@workspace/server/state/settings";
import { sharedMap } from "@/shared/server/processState";
import type { SessionProvider } from "./provider";
import { copilotProvider } from "./copilot/provider";
import { codexProvider } from "./codex/provider";
import { claudeProvider } from "./claude/provider";

export const sessionProviders: readonly SessionProvider[] = [
  copilotProvider,
  codexProvider,
  claudeProvider,
];

const modelsByProvider = sharedMap<Promise<ModelInfo[]>>("provider-models");

export function getSessionProvider(id: string): SessionProvider {
  const provider = sessionProviders.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown session provider: ${id}.`);
  return provider;
}

export async function getProviderCatalog(): Promise<ProviderCatalog> {
  const providers = providerInfo();
  return { providers, models: await collectAvailable(readModels, providers) };
}

export async function listModels(): Promise<ModelInfo[]> {
  return (await getProviderCatalog()).models;
}

function readModels(provider: SessionProvider): Promise<ModelInfo[]> {
  const cached = modelsByProvider.get(provider.id);
  if (cached) return cached;

  const models = provider
    .listModels()
    .then((models) => models.map((model) => ({ ...model, providerName: provider.name })))
    .catch((error) => {
      modelsByProvider.delete(provider.id);
      throw error;
    });
  modelsByProvider.set(provider.id, models);
  return models;
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
  modelsByProvider.clear();
  await Promise.allSettled(sessionProviders.map((provider) => provider.stop()));
}

async function collectAvailable<T>(
  read: (provider: SessionProvider) => Promise<T[]>,
  catalog = providerInfo(),
): Promise<T[]> {
  const { disabledProviders } = await getSettings();
  const providers = catalog
    .filter((provider) => provider.installed && !disabledProviders.includes(provider.id))
    .map((provider) => getSessionProvider(provider.id));
  const results = await Promise.allSettled(providers.map(read));
  const values: T[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      values.push(...result.value);
    } else console.error(`Unable to discover ${providers[index]!.name}:`, result.reason);
  }
  return values;
}

function providerInfo() {
  return sessionProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    installed: provider.isInstalled(),
  }));
}
