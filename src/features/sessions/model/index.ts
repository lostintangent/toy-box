import type { SessionContext, SessionMetadata } from "@github/copilot-sdk";
import type { JSONType } from "zod";
import type { WorkspaceFile } from "@files/model";
import type { ModelConfiguration } from "./modelConfiguration";
import type { AgentNotification } from "./agentNotifications";
import type { Attachment, SessionType } from "./protocol";

export type { ModelInfo, SessionContext, SessionMetadata } from "@github/copilot-sdk";
export type { AgentNotification } from "./agentNotifications";
export type { Attachment, SessionLaunch, SessionMessage, SessionType } from "./protocol";

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

export type SessionsState = {
  sessions: SessionMetadata[];
  worktrees: Record<string, SessionWorktree>;
  /** Worker session ID to its parent session ID, or null for app-owned workers. */
  workerSessionParents: Record<string, string | null>;
};

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

export type SessionStatus =
  | "idle"
  | "waiting"
  | "thinking"
  | "compacting"
  | "reasoning"
  | "responding";

/** The observable result of waiting for a session's current execution. */
export type SessionCompletion = {
  status: "completed" | "failed" | "timed_out";
  response?: string;
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

type SessionCanvasOpen = Omit<SessionCanvas, "key" | "revision">;

export type SessionArtifactPatch = {
  type: "upsert" | "delete";
  path: string;
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

type SubAgent = {
  content?: string;
  model?: ModelConfiguration;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
};

export type SessionQuestionBase = {
  question: string;
  choices?: string[];
  allowFreeform: boolean;
};

export type SessionQuestion = SessionQuestionBase &
  (
    | { state: "unanswered" }
    | { state: "pending"; requestId: string }
    | { state: "answered"; answer: string }
  );

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
  question?: SessionQuestion;
};

/** Build a data URL from an attachment's base64 content and MIME type. */
export function toDataUrl(attachment: Attachment): string | undefined {
  if (!attachment.base64) return undefined;
  return `data:${attachment.mimeType};base64,${attachment.base64}`;
}

export type QueuedUserMessage = Omit<UserMessage, "timestamp"> & {
  clientId: string;
  model?: ModelConfiguration;
  /** Immediate delivery has been requested, but the canonical SDK user message has not arrived. */
  immediate?: true;
};

type QueuedAgentNotificationMessage = Omit<AgentNotificationMessage, "timestamp"> & {
  clientId: string;
};

export type QueuedMessage = QueuedUserMessage | QueuedAgentNotificationMessage;

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

export type SessionEvent = (
  | {
      type: "user_message";
      content: string;
      attachments?: Attachment[];
      timestamp?: string;
      clientId?: string;
    }
  | {
      type: "agent_notification";
      notification: AgentNotification;
      timestamp?: string;
      clientId?: string;
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
      question?: SessionQuestionBase;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      agentId?: string;
      success: boolean;
      result?: string;
      details?: string;
    }
  | {
      type: "question_requested";
      toolCallId: string;
      requestId: string;
      question: SessionQuestionBase;
    }
  | {
      type: "question_resolved";
      toolCallId: string;
      answer: string;
    }
  | { type: "status"; status: SessionStatus }
  | { type: "todos_patch"; patches: TodoItemPatch[] }
  | { type: "session_title_changed"; title: string }
  | { type: "message_queued"; message: QueuedMessage }
  | { type: "message_cancelled"; clientId: string }
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
};

export type SessionMetadataUpdate = {
  sessionId: string;
  startTime?: string;
  modifiedTime?: string;
  summary?: string;
  isRemote?: boolean;
  context?: SessionContext;
  worktree?: SessionWorktree;
  parentSessionId?: string;
  sessionType?: SessionType;
};
