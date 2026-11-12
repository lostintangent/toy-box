// Process-environment facet: facts about the server process surfaced to clients through the
// workspace snapshot. Each is read once or from an environment variable, so it is fixed for the
// life of the process: passive snapshot data, never mutated by workspace events, only refreshed
// by rehydration.

import { hostname } from "node:os";
import type { WorkspaceEnvironment } from "@workspace/model/state/reducer";

/** The name the owner gave this machine: macOS's Computer Name, or else its hostname. */
export const computerName =
  (process.platform === "darwin" &&
    Bun.spawnSync(["scutil", "--get", "ComputerName"]).stdout.toString().trim()) ||
  hostname();

export function getEnvironment(): WorkspaceEnvironment {
  return {
    // Voice mints realtime tokens with the OpenAI key server-side; the client
    // uses this flag to decide whether to offer the composer's voice affordance.
    voiceEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    computerName,
  };
}
