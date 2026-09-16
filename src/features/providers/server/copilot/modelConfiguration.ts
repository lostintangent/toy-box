import type { CopilotSession, SessionConfig as SdkSessionConfig } from "@github/copilot-sdk";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";

type SdkSetModelOptions = NonNullable<Parameters<CopilotSession["setModel"]>[1]>;
type SdkSessionModelOptions = Pick<SdkSessionConfig, "model" | "reasoningEffort" | "contextTier">;

/** The SDK's public option unions are narrower than live metadata, so keep
 *  open-string casts in these boundary helpers. */
function toSdkReasoningEffort(reasoningEffort?: string): SdkSessionConfig["reasoningEffort"] {
  return reasoningEffort as SdkSessionConfig["reasoningEffort"];
}

function toSdkContextTier(contextTier?: string): SdkSessionConfig["contextTier"] {
  return contextTier as SdkSessionConfig["contextTier"];
}

export function toSdkSetModelOptions(configuration?: ModelConfiguration): SdkSetModelOptions {
  return {
    ...(configuration?.reasoningEffort
      ? { reasoningEffort: toSdkReasoningEffort(configuration.reasoningEffort) }
      : {}),
    ...(configuration?.contextTier
      ? { contextTier: toSdkContextTier(configuration.contextTier) }
      : {}),
  };
}

export function toSdkSessionModelOptions(
  configuration?: ModelConfiguration,
): SdkSessionModelOptions {
  return {
    model: configuration?.name,
    ...toSdkSetModelOptions(configuration),
  };
}
