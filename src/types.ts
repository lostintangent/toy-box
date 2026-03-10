// Shared types that cross the client/server boundary

import type { SessionContext } from "@github/copilot-sdk";
export type { SessionMetadata, SessionContext, ModelInfo } from "@github/copilot-sdk";

/* Session types (client) */

export type SessionStatus = "idle" | "thinking" | "compacting" | "reasoning" | "responding";

export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

export type TodoItem = {
  id: string;
  title: string;
  status: TodoStatus;
};

export type TodoItemPatch =
  | {
      type: "upsert";
      id: string;
      title?: string;
      status?: TodoStatus;
    }
  | {
      type: "update_all";
      status: TodoStatus;
    }
  | {
      type: "delete";
      id: string;
    };

export type SessionSnapshot = {
  id: string;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  model?: string;
  todos?: TodoItem[];
  lastSeenEventId?: number;
  status: SessionStatus;
  reasoningContent: string;
};

type BaseMessage = {
  content: string;
  timestamp?: string;
  revision?: number;
};

export type UserMessage = BaseMessage & {
  role: "user";
  attachments?: Attachment[];
};

export type AssistantMessage = BaseMessage & {
  role: "assistant";
  toolCalls?: ToolCall[];
};

export type Message = UserMessage | AssistantMessage;

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  arguments: { [key: string]: JsonValue };
  result?: {
    content: string;
    success: boolean;
  };
  childToolCalls?: ToolCall[];
};

export type Attachment = {
  displayName: string;
  mimeType: string;
  base64?: string;
};

/** Build a data URL from an attachment's base64 content and MIME type */
export function toDataUrl(attachment: Attachment): string | undefined {
  if (!attachment.base64) return undefined;
  return `data:${attachment.mimeType};base64,${attachment.base64}`;
}

export type QueuedMessage = UserMessage & {
  id: string;
  model?: string;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/* Session types (server->client replay + streaming) */

export type SessionEvent = (
  | {
      type: "user_message";
      content: string;
      attachments?: Attachment[];
      timestamp?: string;
      clientMessageId?: string;
    }
  | {
      type: "assistant_message";
      content: string;
      toolCalls?: ToolCall[];
    }
  | { type: "todos_patch"; patches: TodoItemPatch[] }
  | { type: "delta"; content: string }
  | { type: "reasoning"; content: string }
  | {
      type: "tool_start";
      toolName: string;
      toolCallId: string;
      parentToolCallId?: string;
      arguments: { [key: string]: JsonValue };
    }
  | { type: "tool_progress"; toolCallId: string; message: string }
  | {
      type: "tool_end";
      toolCallId: string;
      parentToolCallId?: string;
      success: boolean;
      result?: string;
    }
  | { type: "thinking" }
  | { type: "intent"; intent: string }
  | { type: "session_title_changed"; title: string }
  | { type: "compacting_start" }
  | { type: "compacting_end" }
  | { type: "message_queued"; queuedMessageId: string; content: string; attachments?: Attachment[] }
  | { type: "message_cancelled"; queuedMessageId: string }
  | { type: "message_dequeued"; content: string; queuedMessageId?: string }
  | { type: "model_changed"; model: string }
  | { type: "stream_end"; reason: "idle" | "error" }
) & {
  eventId?: number;
  turnId?: string;
};

/* SSE updates (server->client protocol) */

export type ServerUpdateEvent = SessionsUpdateEvent | AutomationsUpdateEvent;

export type SessionsUpdateEvent =
  | {
      type: "session.upserted";
      session: SessionMetadataUpdate;
    }
  | SimpleSessionUpdateEvents<"deleted" | "running" | "idle" | "unread" | "read">;

type SimpleSessionUpdateEvents<EventName extends string> = {
  type: `session.${EventName}`;
  sessionId: string;
};

export type AutomationsUpdateEvent =
  | {
      type: "automation.added";
      automation: Automation;
    }
  | {
      type: "automation.deleted";
      automationId: string;
    }
  | {
      type: "automation.updated";
      automation: Automation;
    }
  | {
      type: "automation.started";
      automationId: string;
      sessionId: string;
      startedAt: string; // ISO timestamp
    }
  | {
      type: "automation.finished";
      automationId: string;
      sessionId: string;
      finishedAt: string; // ISO timestamp
      success: boolean;
      automation?: Automation;
    };

export type SessionMetadataUpdate = {
  sessionId: string;
  startTime?: string; // ISO timestamp
  modifiedTime?: string; // ISO timestamp
  summary?: string;
  replaceSummary?: boolean;
  isRemote?: boolean;
  context?: SessionContext;
};

/* Terminal (client->server protocol) */

export const DEFAULT_TERMINAL_WS_PORT = 3001;

export type TerminalClientMessage =
  | { type: "init"; clientId: string; cols?: number; rows?: number; shell?: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

export type TerminalServerMessage = { type: "ready"; resumed: boolean } | { type: "exit" };

/* Automations */

export type AutomationOptions = {
  title: string;
  prompt: string;
  model: string;
  cron: string;
  reuseSession: boolean;
  cwd?: string;
};

export type Automation = AutomationOptions & {
  id: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  nextRunAt: string; // ISO timestamp
  lastRunAt?: string; // ISO timestamp
  lastRunSessionId?: string;
};
