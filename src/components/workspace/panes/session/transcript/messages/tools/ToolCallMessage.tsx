import type { ComponentType } from "react";
import type { ToolCall } from "@/types";
import { AgentToolCall } from "./AgentToolCall";
import { BashToolCall } from "./BashToolCall";
import { FileDiffToolCall } from "./FileDiffToolCall";
import { DefaultToolCall } from "./DefaultToolCall";
import { GlobToolCall } from "./GlobToolCall";
import { ReadToolCall } from "./ReadToolCall";
import { SqlToolCall } from "./SqlToolCall";
import { WebFetchToolCall } from "./WebFetchToolCall";
import type { ToolCallProps } from "./types";

export interface ToolCallMessageProps {
  toolCall: ToolCall;
  isActive: boolean;
}

const TOOL_RENDERERS: Record<string, ComponentType<ToolCallProps>> = {
  bash: BashToolCall,
  read: ReadToolCall,
  glob: GlobToolCall,
  grep: GlobToolCall,
  edit: FileDiffToolCall,
  patch: FileDiffToolCall,
  fetch: WebFetchToolCall,
  sql: SqlToolCall,
  agent: AgentToolCall,
};

export function ToolCallMessage({ toolCall, isActive }: ToolCallMessageProps) {
  const Renderer = TOOL_RENDERERS[toolCall.name] ?? DefaultToolCall;
  return <Renderer toolCall={toolCall} isActive={isActive} />;
}
