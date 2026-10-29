import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { CopilotClient, SessionConfig } from "@github/copilot-sdk";

// Workaround seen through CLI 1.0.105-1: headless SDK servers load no built-in plugins.
// Remove when the SDK exposes computer use or the headless CLI honors the user's setting.
export async function computerUseServers(
  client: Pick<CopilotClient, "getStatus">,
  home = homedir(),
): Promise<SessionConfig["mcpServers"]> {
  const file = Bun.file(join(home, ".copilot", "settings.json"));
  if (!(await file.exists())) return undefined;
  const settings = z
    .object({ enabledMcpServers: z.array(z.string()).optional() })
    .parse(await file.json());
  if (!settings.enabledMcpServers?.includes("computer-use")) return undefined;
  const { version } = await client.getStatus();
  const command = join(
    home,
    "Library",
    "Caches",
    "copilot",
    "pkg",
    `${process.platform}-${process.arch}`,
    version,
    "plugins",
    "computer-use",
    "computer-use-mcp",
  );
  if (!(await Bun.file(command).exists())) {
    console.warn(
      `Copilot computer use is enabled, but its ${version} binary was not found. Continuing without computer use.`,
    );
    return undefined;
  }
  return {
    "computer-use": { type: "stdio", command, args: [], workingDirectory: dirname(command) },
  };
}
