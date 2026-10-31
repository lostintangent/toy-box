import type { CopilotSession, SessionConfig as SdkSessionConfig } from "@github/copilot-sdk";
import type { ModelConfiguration } from "@providers/model";

type SdkSetModelOptions = NonNullable<Parameters<CopilotSession["setModel"]>[1]>;

// The SDK's public option unions are narrower than live metadata, so these
// open strings are cast at the boundary.
export function toSdkSetModelOptions(configuration?: ModelConfiguration): SdkSetModelOptions {
  return {
    ...(configuration?.reasoningEffort
      ? { reasoningEffort: configuration.reasoningEffort as SdkSessionConfig["reasoningEffort"] }
      : {}),
    ...(configuration?.contextTier
      ? { contextTier: configuration.contextTier as SdkSessionConfig["contextTier"] }
      : {}),
  };
}
