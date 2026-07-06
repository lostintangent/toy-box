// Shared types that cross the client/server boundary

import type { SessionContext } from "@github/copilot-sdk";
export type { SessionMetadata, SessionContext, ModelInfo } from "@github/copilot-sdk";

/** Open-ended on purpose: the SDK's public union can lag the wire protocol
 *  and model catalog values such as "none" and "max". */
export type ReasoningEffort = string;

export type ModelConfiguration = {
  model: string;
  reasoningEffort?: ReasoningEffort;
};

/* Skills (directory-scoped — resolved from .claude/ dirs, plugins, etc.) */

export type SessionSkill = {
  name: string;
  description: string;
};

export type SessionWorktree = {
  path: string;
  branch: string;
  baseBranch: string;
  linesAdded?: number;
  linesRemoved?: number;
};

/* Todos (structured patches from SQL tool calls) */

export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

export type TodoItem = {
  id: string;
  title: string;
  status: TodoStatus;
};

export type TodoItemPatch =
  | { type: "upsert"; id: string; title?: string; status?: TodoStatus }
  | { type: "update_all"; status: TodoStatus }
  | { type: "delete"; id: string };

/* Session types (client) */

export type SessionStatus = "idle" | "thinking" | "compacting" | "reasoning" | "responding";

export type SessionCanvas = {
  key: string;
  extensionId?: string;
  extensionName?: string;
  canvasId: string;
  instanceId: string;
  title: string;
  url: string;
  status?: string;
  input?: JsonValue;
  revision: number;
};

export type SessionCanvasOpen = Omit<SessionCanvas, "key" | "revision">;

export type SessionArtifactPatch = {
  type: "upsert" | "delete";
  path: string;
};

/**
 * A user-registered artifact viewer. Each one teaches Toy Box how to render (and
 * optionally edit) files with a given extension using a self-contained HTML/JS
 * template. Definitions live on disk under `~/.toy-box/artifacts/<name>/`
 * (`artifact.json` + `index.html`) and are surfaced to the client through
 * workspace state, so a session that produces a matching file opens straight into
 * the custom view.
 */
export type CustomArtifactKind = {
  /** Unique id and on-disk folder name, e.g. `json-tree`. */
  name: string;
  /** File extensions (without the dot) this kind claims, e.g. `["json"]`. */
  extensions: string[];
  /** Curated icon name (see the client icon map); falls back to a generic file icon. */
  icon?: string;
  /** Whether the template can write edits back to the file. Read-only when false. */
  editable?: boolean;
  /** The `index.html` template: a standalone document that renders the file content. */
  html: string;
};

export type SessionSnapshot = {
  id: string;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  modelConfiguration?: ModelConfiguration;
  todos?: TodoItem[];
  linkedSessionIds?: string[];
  canvases?: SessionCanvas[];
  artifacts?: string[];
  lastSeenEventId?: number;
  status: SessionStatus;
  reasoningContent: string;
};

export type UserMessage = {
  role: "user";
  content: string;
  attachments?: Attachment[];
  timestamp?: string;
};

export type AgentNotification = { type: "artifact_edited"; path: string };

export type AgentNotificationMessage = {
  role: "agent_notification";
  notification: AgentNotification;
  timestamp?: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
  timestamp?: string;
  revision?: number;
};

export type Message = UserMessage | AgentNotificationMessage | AssistantMessage;

export type SubAgent = {
  content?: string;
  modelConfiguration?: ModelConfiguration;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: { [key: string]: JsonValue };
  result?: {
    content: string;
    success: boolean;
    details?: string;
  };
  agent?: SubAgent;
};

export type Attachment = {
  displayName: string;
  mimeType: string;
  base64: string;
};

/** Build a data URL from an attachment's base64 content and MIME type */
export function toDataUrl(attachment: Attachment): string | undefined {
  if (!attachment.base64) return undefined;
  return `data:${attachment.mimeType};base64,${attachment.base64}`;
}

export type QueuedUserMessage = Omit<UserMessage, "timestamp"> & {
  id: string;
  modelConfiguration?: ModelConfiguration;
};

export type QueuedAgentNotificationMessage = Omit<AgentNotificationMessage, "timestamp"> & {
  id: string;
};

export type QueuedMessage = QueuedUserMessage | QueuedAgentNotificationMessage;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DraftSession = {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
};

export type DraftPrompt = {
  text: string;
  updatedAt: number;
  origin: string;
};

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
      type: "agent_notification";
      notification: AgentNotification;
      timestamp?: string;
    }
  | {
      type: "assistant_message";
      content: string;
      agentId?: string;
    }
  | { type: "delta"; content: string; agentId?: string }
  | { type: "reasoning"; content: string; agentId?: string }
  | {
      type: "tool_start";
      toolName: string;
      toolCallId: string;
      agentId?: string;
      arguments: { [key: string]: JsonValue };
    }
  | {
      type: "tool_end";
      toolCallId: string;
      agentId?: string;
      success: boolean;
      result?: string;
      details?: string;
    }
  | { type: "status"; status: SessionStatus }
  | { type: "todos_patch"; patches: TodoItemPatch[] }
  | { type: "session_title_changed"; title: string }
  | {
      type: "message_queued";
      message: QueuedMessage;
    }
  | { type: "message_cancelled"; queuedMessageId: string }
  | { type: "message_dequeued"; message: QueuedMessage }
  | { type: "model_changed"; modelConfiguration: ModelConfiguration; agentId?: string }
  | { type: "skills"; skills: SessionSkill[] }
  | { type: "linked_session_added"; sessionId: string }
  | { type: "linked_session_removed"; sessionId: string }
  | { type: "canvas_opened"; canvas: SessionCanvasOpen }
  | { type: "artifacts_patch"; patches: SessionArtifactPatch[] }
  | { type: "end"; reason: "idle" | "error" }
) & {
  eventId?: number;
  turnId?: string;
};

/* SSE updates (server->client protocol) */

export type ServerUpdateEvent = WorkspaceEvent | AutomationsUpdateEvent;

export type WorkspaceEvent =
  | {
      type: "session.upserted";
      session: SessionMetadataUpdate;
    }
  | {
      type: "session.draft.created";
      draft: DraftSession;
    }
  | {
      type: "session.prompt.drafted";
      sessionId: string;
      prompt: DraftPrompt;
    }
  | SimpleSessionUpdateEvents<
      | "deleted"
      | "running"
      | "idle"
      | "unread"
      | "read"
      | "draft.discarded"
      | "hyper.created"
      | "hyper.promoted"
    >;

// Actions are the client-issuable subset of workspace events. `unread` is
// intentionally absent: the server is authoritative for it (a session becomes
// unread from agent output, never from a client request), so clients only ever
// receive it as an event and dispatch its inverse, `session.read`.
type WorkspaceActionType =
  | "session.draft.created"
  | "session.prompt.drafted"
  | "session.draft.discarded"
  | "session.hyper.created"
  | "session.hyper.promoted"
  | "session.read";

export type WorkspaceAction = Extract<WorkspaceEvent, { type: WorkspaceActionType }>;

type SimpleSessionUpdateEvents<EventName extends string> = EventName extends string
  ? {
      type: `session.${EventName}`;
      sessionId: string;
    }
  : never;

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
  isRemote?: boolean;
  context?: SessionContext;
  worktree?: SessionWorktree;
  parentSessionId?: string;
};

export type FileWatchEvent = { type: "modified"; timestamp: number } | { type: "deleted" };

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
  modelConfiguration: ModelConfiguration;
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
