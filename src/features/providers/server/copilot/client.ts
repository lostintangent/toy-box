// One Copilot SDK process, shared by every native session and catalog request.

import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { realpathSync } from "node:fs";
import { sharedMap } from "@/shared/server/processState";

const copilotClients = sharedMap<Promise<CopilotClient>>("copilot-clients");

export async function stopCopilotClient(): Promise<void> {
  const client = copilotClients.get("shared");
  copilotClients.delete("shared");
  if (client) await (await client).stop();
}

/** Start or reuse the one Copilot process shared by every server operation. */
export function startCopilotClient(): Promise<CopilotClient> {
  const existing = copilotClients.get("shared");
  if (existing) return existing;

  const promise = (async () => {
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: resolveCopilotCliPath() }),
      // TODO: Re-test SDK/CLI idle GC after upgrades. Once an expired session
      // resumes reliably, use the native timeout and remove registry-owned expiry.
      sessionIdleTimeoutSeconds: 0,
      // Make a compiled Bun executable behave like the Bun CLI when the SDK
      // uses process.execPath for child JavaScript entrypoints.
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    });
    await client.start();
    return client;
  })();
  copilotClients.set("shared", promise);
  void promise.catch(() => {
    if (copilotClients.get("shared") === promise) copilotClients.delete("shared");
  });
  return promise;
}

/** Use the SDK-pinned CLI in development and the user's installed CLI in production. */
function resolveCopilotCliPath(): string {
  if (import.meta.env.DEV) {
    return Bun.resolveSync(`@github/copilot-${process.platform}-${process.arch}`, process.cwd());
  }

  try {
    const copilotBin = Bun.which("copilot");
    if (copilotBin) {
      try {
        return realpathSync(copilotBin);
      } catch {
        return copilotBin;
      }
    }
  } catch {
    // PATH lookup failed; report the actionable installation error below.
  }

  throw new Error(
    "Could not find `copilot` on PATH. Install it globally with `npm i -g @github/copilot`.",
  );
}
