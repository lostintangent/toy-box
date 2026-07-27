// Custom tool registry. Each tool module exports definitions; handlers that
// call back into the session runtime or automation RPCs import them lazily so
// registry initialization does not form a module cycle through this catalog.

import type { Tool } from "@github/copilot-sdk";
import { editorTools } from "./editors";
import { automationTools } from "./automations";
import { coordinationTools } from "./coordination";
import { fileTools } from "./files";
import { inboxTools } from "./inbox";
import { hyperLifecycleTools, lifecycleTools, sessionLayoutTools } from "./lifecycle";
import { settingsTools } from "./settings";
import type { SessionType } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSessionTools(sessionType: SessionType): Tool<any>[] {
  const interactive = sessionType === "standard" || sessionType === "hyper";
  const canUpdateSettings = sessionType === "automation" || sessionType === "hyper";
  return [
    ...(sessionType === "hyper" ? hyperLifecycleTools : []),
    ...lifecycleTools,
    ...(interactive ? sessionLayoutTools : []),
    ...(interactive ? fileTools : []),
    ...coordinationTools,
    ...automationTools,
    ...(canUpdateSettings ? settingsTools : []),
    ...(sessionType === "hyper" ? editorTools : []),
    ...(sessionType === "inbox" ? inboxTools : []),
  ].map((tool) => ({
    ...tool,
    // These are Toy Box control-plane tools, so they must be present in the
    // model's immediate catalog rather than deferred behind tool search.
    defer: "never",
  }));
}
