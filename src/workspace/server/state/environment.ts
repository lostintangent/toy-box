// Process-environment facet: the server runtime configuration surfaced to
// clients through the workspace snapshot. Values derive from environment
// variables fixed for the life of the process, so they are passive snapshot
// data — never mutated by workspace events, only refreshed by rehydration.

import type { WorkspaceEnvironment } from "@workspace/model/state/reducer";

export function getEnvironment(): WorkspaceEnvironment {
  return {
    // Voice mints realtime tokens with the OpenAI key server-side; the client
    // uses this flag to decide whether to offer the composer's voice affordance.
    voiceEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}
