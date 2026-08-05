// Shared types that cross the client/server boundary

import type { SessionContext } from "@github/copilot-sdk";
import type { JSONType } from "zod";
export type { SessionMetadata, SessionContext, ModelInfo } from "@github/copilot-sdk";
import type { AppIconName } from "@/lib/apps/icons";
import type { HexColor } from "@/lib/utils";
import type { WorkspaceAction } from "@/lib/workspace/state/actions";

/* Workspace settings */

export type Settings = {
  accentColor: HexColor;
  defaultModel: ModelConfiguration | null;
  terminalShell: string;
  useWorktree: boolean;
  autoFocusArtifacts: "always" | "sessions" | "automations" | "never";
  showExternalSessions: boolean;
  pinnedSessionIds: string[];
};

export type ModelConfiguration = {
  name: string;
  reasoningEffort?: string;
};

/* Skills (resolved for a CWD, or from host-level sources without one) */

export type SessionSkill = {
  name: string;
  description: string;
  type: "project" | "global";
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

/* Session state */

export type SessionStatus = "idle" | "thinking" | "compacting" | "reasoning" | "responding";

/** A session's product role, derived from the domain record that manages it. */
export type SessionType = "standard" | "automation" | "inbox" | "hyper" | "worker";

/** The observable result of waiting for a session's current execution. */
export type SessionCompletion = {
  status: "completed" | "failed" | "timed_out";
  response?: string;
};

export type SessionMessage = {
  id?: string;
  content: string;
  attachments?: Attachment[];
  model?: ModelConfiguration;
};

export type SessionLaunch = {
  message: SessionMessage;
  directory?: string;
  useWorktree?: boolean;
};

export type SessionCanvas = {
  key: string;
  extensionId?: string;
  extensionName?: string;
  canvasId: string;
  instanceId: string;
  title: string;
  url: string;
  status?: string;
  input?: JSONType;
  revision: number;
};

export type SessionCanvasOpen = Omit<SessionCanvas, "key" | "revision">;

export type SessionArtifactPatch = {
  type: "upsert" | "delete";
  path: string;
};

/**
 * A user-registered editor. Each one teaches Toy Box how to render (and
 * optionally edit) files with a given extension using a self-contained HTML/JS
 * template. Definitions live on disk under `~/.toy-box/editors/<name>/`
 * (`editor.json` + `index.html`) and are surfaced to the client through
 * workspace state, so a session that produces a matching file opens straight into
 * the custom view.
 */
export type CustomEditorKind = {
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
  model?: ModelConfiguration;
  todos?: TodoItem[];
  linkedSessionIds?: string[];
  canvases?: SessionCanvas[];
  artifacts?: string[];
  openedFiles?: WorkspaceFile[];
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

/** One address for a file surfaced in the workspace: a session's file (an artifact) or a real host file. */
export type WorkspaceFile =
  | { type: "session"; sessionId: string; path: string }
  | { type: "machine"; path: string };

/** How a mounted workspace surface presents and shares edits to a file. */
export type WorkspaceFileMode = "read" | "edit" | "shared";

export type AgentNotification = { type: "file_edited"; file: WorkspaceFile };

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
};

export type Message = UserMessage | AgentNotificationMessage | AssistantMessage;

export type SubAgent = {
  content?: string;
  model?: ModelConfiguration;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: { [key: string]: JSONType };
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
  model?: ModelConfiguration;
  /** Immediate delivery has been requested, but the canonical SDK user
   *  message has not arrived yet. */
  isSteering?: true;
};

export type QueuedAgentNotificationMessage = Omit<AgentNotificationMessage, "timestamp"> & {
  id: string;
};

export type QueuedMessage = QueuedUserMessage | QueuedAgentNotificationMessage;

/* Apps */

/** The serializable state contract authored in an app manifest. */
export type AppStateDefinition = {
  schema: JSONType;
  default: JSONType;
};

/** An immutable, pending handoff between two saved app instances. */
export type AppShare = {
  id: string;
  sourceAppId: string;
  targetAppId: string;
  mimeType: string;
  content: JSONType;
  createdAt: string;
};

/** An installed TSX component that can back any number of saved app instances. */
export type AppDefinition = {
  /** Stable definition id and owner definition's on-disk folder name. */
  id: string;
  title: string;
  description?: string;
  icon?: AppIconName;
  /** Default Apps-panel icon color for new instances. */
  color: HexColor;
  /** The durable state contract and initial value for new instances. */
  state: AppStateDefinition;
  /** MIME types instances of this definition know how to consume. */
  accepts: string[];
  /** Content-derived identity used to invalidate a loaded component bundle. */
  revision: string;
};

/**
 * A durable, reopenable app surface. Definition code is stored separately;
 * SQLite owns the instance's identity, small state, and revision.
 */
export type AppInstance = {
  id: string;
  definitionId: string;
  title: string;
  color: HexColor;
  state: JSONType;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftPrompt = {
  text: string;
  updatedAt: number;
  origin: string;
};

/** Durable claim that gives a zero-turn SDK session draft UX semantics. */
export type DraftSession = {
  sessionId: string;
  createdAt: number;
  artifactPath?: string;
};

export type InboxEntry = {
  id: string;
  message?: string;
  createdAt: string;
  /** File name of the entry's artifact in its managed session's files directory. */
  artifact?: string;
};

/**
 * A worker session and the resource that owns its lifecycle.
 *
 * Ownership determines supervision and visibility. Ephemerality independently
 * determines whether the supervisor deletes the session after execution.
 */
export type Worker = {
  sessionId: string;
  ephemeral: boolean;
  name?: string;
  metadata?: JSONType;
} & (
  | { type: "session"; parentSessionId: string }
  | { type: "file"; file: Extract<WorkspaceFile, { type: "session" }> }
  | { type: "app"; appId: string }
);

/* Session types (server->client replay + streaming) */

export type SessionEvent = (
  | {
      type: "user_message";
      content: string;
      attachments?: Attachment[];
      timestamp?: string;
      clientMessageId?: string;
      /** This is the canonical SDK event for a queued message that was steered. */
      isSteered?: true;
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
      arguments: { [key: string]: JSONType };
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
  | { type: "message_dequeued"; queuedMessageId: string }
  | { type: "model_changed"; model: ModelConfiguration; agentId?: string }
  | { type: "linked_session_added"; sessionId: string }
  | { type: "linked_session_removed"; sessionId: string }
  | { type: "canvas_opened"; canvas: SessionCanvasOpen }
  | { type: "artifacts_patch"; patches: SessionArtifactPatch[] }
  | { type: "file_opened"; file: WorkspaceFile }
  | { type: "file_closed"; file: WorkspaceFile }
  | { type: "end"; reason: "idle" | "error" }
) & {
  eventId?: number;
  turnId?: string;
};

/* SSE updates (server->client protocol) */

// Shared updates broadcast to clients. The first arm is the client-issuable
// subset (WorkspaceAction, defined and validated in @/lib/workspace/state/actions);
// the rest are server-authoritative events a client only receives.
export type WorkspaceEvent =
  | WorkspaceAction
  | {
      type: "session.drafted";
      sessionId: string;
      createdAt: number;
      artifactPath?: string;
      hyper?: true;
    }
  | {
      type: "settings.changed";
      settings: Settings;
    }
  | {
      type: "session.upserted";
      session: SessionMetadataUpdate;
    }
  | SimpleSessionUpdateEvents<"deleted" | "running" | "idle" | "unread">
  | {
      type: "inbox.entry.upserted";
      entry: InboxEntry;
    }
  | {
      type: "inbox.entry.deleted";
      entryId: string;
    }
  | {
      type: "editor.registered";
      kind: CustomEditorKind;
    }
  | {
      type: "app.registered";
      definition: AppDefinition;
    }
  | {
      type: "app.unregistered";
      definitionId: string;
    }
  | {
      type: "app.upserted";
      app: AppInstance;
    }
  | {
      type: "app.deleted";
      appId: string;
    }
  | {
      type: "app.share.created";
      share: AppShare;
    }
  | {
      type: "app.share.deleted";
      shareId: string;
    }
  | {
      type: "worker.started";
      worker: Worker;
    }
  | {
      type: "worker.finished";
      sessionId: string;
    }
  | {
      type: "automation.upserted";
      automation: Automation;
    }
  | {
      type: "automation.deleted";
      automationId: string;
    };

export type { WorkspaceAction };

type SimpleSessionUpdateEvents<EventName extends string> = EventName extends string
  ? {
      type: `session.${EventName}`;
      sessionId: string;
    }
  : never;

export type SessionMetadataUpdate = {
  sessionId: string;
  startTime?: string; // ISO timestamp
  modifiedTime?: string; // ISO timestamp
  summary?: string;
  isRemote?: boolean;
  context?: SessionContext;
  worktree?: SessionWorktree;
  parentSessionId?: string;
  sessionType?: SessionType;
};

export type FileWatchEvent = { type: "modified"; timestamp: number } | { type: "deleted" };

/* Terminal (client->server protocol) */

export type TerminalClientMessage =
  | { type: "init"; clientId: string; cols?: number; rows?: number; shell?: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

export type TerminalServerMessage = { type: "ready"; resumed: boolean } | { type: "exit" };

/* Automations */

export type AutomationOptions = {
  title: string;
  prompt: string;
  model: ModelConfiguration;
  cron: string;
  cwd?: string;
};

export type Automation = AutomationOptions & {
  id: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  nextRunAt: string; // ISO timestamp
  lastRunAt?: string; // ISO timestamp
};
