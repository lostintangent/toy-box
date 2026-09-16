import type { JSONType } from "zod";
import type { WorkspaceFile } from "@files/model";
import type { ModelConfiguration } from "./modelConfiguration";
import type { SessionSystemMessage } from "./systemMessages";
import type { Attachment, SessionType } from "./protocol";

export type SessionContext = {
  workingDirectory: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
};

export type SessionMetadata = {
  sessionId: string;
  /** Drafts do not have a provider until their first turn starts. */
  provider?: string;
  startTime: Date;
  modifiedTime: Date;
  title?: string;
  directory?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
};

export type ModelInfo = import("./modelConfiguration").ModelOptionInfo & {
  id: string;
  name: string;
  provider: string;
  providerName?: string;
};
export type { SessionSystemMessage } from "./systemMessages";
export type { Attachment, SessionLaunch, SessionMessage, SessionType } from "./protocol";

export type SessionSkill = {
  name: string;
  description: string;
  type: "project" | "global";
  path?: string;
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
  | { type: "replace_all"; items: TodoItem[] }
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
  rewindable?: boolean;
  role: "user";
  content: string;
  attachments?: Attachment[];
  timestamp?: string;
};

export type SystemMessage = {
  role: "system";
  content: SessionSystemMessage;
  timestamp?: string;
};

export type AssistantMessage = {
  role: "assistant";
  /** Native identity shared by streamed and committed content. */
  messageId?: string;
  content: string;
  error?: string;
  toolCalls?: ToolCall[];
  timestamp?: string;
};

export type Message = UserMessage | SystemMessage | AssistantMessage;

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
  /** Omitted means blocking, preserving the original single-question contract. */
  blocking?: boolean;
  secret?: boolean;
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
  /** Recipients resolved from visible mention text when the server accepts this message. */
  mentionedAgentIds?: string[];
  /** Immediate delivery has been requested, but the canonical SDK user message has not arrived. */
  immediate?: true;
};

type QueuedSystemMessage = Omit<SystemMessage, "timestamp"> & {
  clientId: string;
  /** Immediate delivery has been requested, but the canonical SDK input has not arrived. */
  immediate?: true;
};

export type QueuedMessage = QueuedUserMessage | QueuedSystemMessage;

export type DraftPrompt = {
  text: string;
  updatedAt: number;
  origin: string;
};

/** Durable public identity and optional artifact, before a provider is selected. */
export type DraftSession = {
  sessionId: string;
  createdAt: number;
  artifactPath?: string;
};

export type SessionEvent = (
  | {
      type: "user_message";
      rewindable?: boolean;
      content: string;
      attachments?: Attachment[];
      timestamp?: string;
      clientId?: string;
    }
  | {
      type: "system_message";
      content: SessionSystemMessage;
      timestamp?: string;
      clientId?: string;
    }
  | {
      type: "assistant_message";
      content: string;
      messageId?: string;
      agentId?: string;
    }
  | { type: "delta"; content: string; messageId?: string; agentId?: string }
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
  | { type: "question_cancelled"; toolCallId: string }
  | { type: "status"; status: SessionStatus }
  | { type: "todos_patch"; patches: TodoItemPatch[] }
  | { type: "session_title_changed"; title: string }
  | { type: "message_queued"; message: QueuedMessage }
  | { type: "message_cancelled"; clientId: string }
  | { type: "model_changed"; model: ModelConfiguration; agentId?: string }
  | { type: "linked_session_added"; sessionId: string }
  | { type: "linked_session_removed"; sessionId: string }
  | { type: "canvas_opened"; canvas: SessionCanvasOpen }
  | { type: "artifacts_changed"; artifacts: string[] }
  | { type: "file_opened"; file: WorkspaceFile }
  | { type: "file_closed"; file: WorkspaceFile }
  | { type: "end"; reason: "idle" | "error"; error?: string }
) & {
  eventId?: number;
};

export type SessionMetadataUpdate = {
  provider?: string;
  sessionId: string;
  startTime?: string;
  modifiedTime?: string;
  title?: string;
  directory?: string;
  worktree?: SessionWorktree;
  parentSessionId?: string;
  sessionType?: SessionType;
};
