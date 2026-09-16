import type { ModelInfo, SessionMetadata } from "@sessions/model";
import type { SessionProvider } from "./provider";
import { copilotProvider } from "./copilot/provider";
import { codexProvider } from "./codex/provider";

export const sessionProviders: readonly SessionProvider[] = [copilotProvider, codexProvider];

export function getSessionProvider(id: string): SessionProvider {
  const provider = sessionProviders.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown session provider: ${id}.`);
  return provider;
}

export function listModels(): Promise<ModelInfo[]> {
  return collectAvailable(async (provider) =>
    (await provider.listModels()).map((model) => ({ ...model, providerName: provider.name })),
  );
}

/** Catalog IDs belong to the native providers; Sessions maps them to public IDs. */
export function listSessions(): Promise<SessionMetadata[]> {
  return collectAvailable(async (provider) =>
    (await provider.listSessions()).map((session) => ({ ...session, provider: provider.id })),
  );
}

export async function stopProviders(): Promise<void> {
  await Promise.allSettled(sessionProviders.map((provider) => provider.stop()));
}

async function collectAvailable<T>(
  read: (provider: SessionProvider) => Promise<T[]>,
): Promise<T[]> {
  const providers = sessionProviders.filter((provider) => provider.isInstalled());
  if (!providers.length)
    throw new Error("Install and sign in to Codex or GitHub Copilot to start sessions.");
  const results = await Promise.allSettled(providers.map(read));
  const values: T[] = [];
  const failures: string[] = [];
  let succeeded = false;
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      succeeded = true;
      values.push(...result.value);
    } else failures.push(`${providers[index]!.name}: ${String(result.reason)}`);
  }
  if (!succeeded) throw new Error(failures.join("\n"));
  return values;
}
