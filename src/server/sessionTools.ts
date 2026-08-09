// Custom tool registry. Each tool module exports definitions; handlers that
// call back into the session runtime or automation RPCs import them lazily so
// registry initialization does not form a module cycle through this catalog.

import type { Tool } from "@github/copilot-sdk";
import { automationTools } from "@automations/server/tools";
import { appLifecycleTools, createAppStateTools } from "@apps/server/tools";
import { editorTools, fileTools } from "@files/server/tools";
import { inboxTools } from "@inbox/server/tools";
import { workerTools } from "@workers/server/tools";
import {
  coordinationTools,
  hyperLifecycleTools,
  lifecycleTools,
  sessionLayoutTools,
} from "@sessions/server/tools";
import { settingsTools } from "./settingsTools";
import type { SessionType } from "@sessions/model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSessionTools(sessionType: SessionType, appId?: string): Tool<any>[] {
  const interactive = sessionType === "standard" || sessionType === "hyper";
  const canUpdateSettings = sessionType === "automation" || sessionType === "hyper";
  return [
    ...(sessionType === "hyper" ? hyperLifecycleTools : []),
    ...workerTools,
    ...lifecycleTools,
    ...(interactive ? sessionLayoutTools : []),
    ...(interactive ? fileTools : []),
    ...coordinationTools,
    ...automationTools,
    ...createAppStateTools(sessionType === "worker" ? appId : undefined),
    ...(canUpdateSettings ? settingsTools : []),
    ...(sessionType === "hyper" ? editorTools : []),
    ...(sessionType === "hyper" ? appLifecycleTools : []),
    ...(sessionType === "inbox" ? inboxTools : []),
  ].map((tool) => ({
    ...tool,
    // These are Toy Box control-plane tools, so they must be present in the
    // model's immediate catalog rather than deferred behind tool search.
    defer: "never",
  }));
}
