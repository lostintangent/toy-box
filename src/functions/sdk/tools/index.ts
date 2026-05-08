// Custom tool registry. Each tool module exports an array of Tool
// definitions; this module collects them into a single list for the SDK.

import type { Tool } from "@github/copilot-sdk";
import { automationTools } from "./automations";
import { coordinationTools } from "./coordination";
import { lifecycleTools } from "./lifecycle";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTools(): Tool<any>[] {
  return [...lifecycleTools, ...coordinationTools, ...automationTools];
}
