// Process-environment facet: the server runtime configuration surfaced to
// clients through the workspace snapshot. Values derive from environment
// variables fixed for the life of the process, so they are passive snapshot
// data — never mutated by workspace events, only refreshed by rehydration.

import type { WorkspaceEnvironment } from "@/lib/workspace/state/reducer";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";

export function getEnvironment(): WorkspaceEnvironment {
  return {
    terminalWsPort: parsePort(process.env.TERMINAL_WS_PORT),
    // Voice mints realtime tokens with the OpenAI key server-side; the client
    // uses this flag to decide whether to offer the composer's voice affordance.
    voiceEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

const MIN_PORT = 1;
const MAX_PORT = 65_535;

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return DEFAULT_TERMINAL_WS_PORT;
  }
  return parsed;
}
