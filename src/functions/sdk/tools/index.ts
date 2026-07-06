// Custom tool registry. Each tool module exports an array of Tool
// definitions; this module collects them into a single list for the SDK.

import type { Tool } from "@github/copilot-sdk";
import { artifactKindTools } from "./artifacts";
import { automationTools } from "./automations";
import { coordinationTools } from "./coordination";
import { lifecycleTools } from "./lifecycle";

// A session's scope determines which control-plane tools it gets. Directory
// sessions are scoped to a project working directory; user sessions are global
// "hyper" sessions created without a working directory.
export type SessionScope = "user" | "directory";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTools({ scope }: { scope: SessionScope }): Tool<any>[] {
  return [
    ...lifecycleTools,
    ...coordinationTools,
    ...automationTools,
    // register_artifact_kind manages global artifact viewers (saved under
    // ~/.toy-box and applied to every session), so it is only offered to
    // user-scoped global/hyper sessions. Directory-scoped project sessions omit
    // it to keep their per-turn tool catalog lean.
    ...(scope === "user" ? artifactKindTools : []),
  ].map((tool) => ({
    ...tool,
    // These are Toy Box control-plane tools, so they must be present in the
    // model's immediate tool catalog on both new and resumed sessions.
    defer: "never",
  }));
}
