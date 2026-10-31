// One Copilot SDK process, shared by every native session and catalog request.

import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
      // Make a compiled Bun executable behave like the Bun CLI when the SDK
      // uses process.execPath for child JavaScript entrypoints.
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    });
    await client.start();
    await registerComputerUse(client).catch((error) =>
      console.warn("Copilot is running without computer use.", error),
    );
    return client;
  })();
  copilotClients.set("shared", promise);
  void promise.catch(() => {
    if (copilotClients.get("shared") === promise) copilotClients.delete("shared");
  });
  return promise;
}

// Workaround seen through CLI 1.0.105: headless servers register none of the CLI's bundled
// plugins. Register the running version's computer-use plugin, and the CLI applies the user's
// opt-in itself. It ignores a missing folder. Remove when headless servers load bundled plugins.
async function registerComputerUse(client: CopilotClient): Promise<void> {
  const { version } = await client.getStatus();
  const pkg = join(homedir(), "Library/Caches/copilot/pkg", `${process.platform}-${process.arch}`);
  await client.rpc.plugins.builtin.set({ paths: [join(pkg, version, "plugins/computer-use")] });
}

/** Run the installed CLI, which Settings also reports and updates. */
function resolveCopilotCliPath(): string {
  const copilotBin = Bun.which("copilot");
  if (!copilotBin) {
    throw new Error(
      "Could not find `copilot` on PATH. Install it globally with `npm i -g @github/copilot`.",
    );
  }
  return realpathSync(copilotBin);
}
