import type { JSONType } from "zod";
import type { WorkspaceFile } from "@files/model";
import type { ModelConfiguration } from "@providers/model";
import type { SessionSystemMessage } from "./systemMessages";
import type { Attachment, SessionType } from "./protocol";

export type SessionContext = {
  directory?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
};

/** Identity and catalog metadata. A session without a provider has not started. */
export type Session = {
  id: string;
  provider?: {
    id: string;
    /** Native ID override; omitted when the provider uses this session's ID. */
    sessionId?: string;
  };
  context?: SessionContext;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Initial artifact, supplied as the first turn's subject. */
  artifactPath?: string;
};

export type { SessionSystemMessage } from "./systemMessages";
export type { Attachment, SessionLaunch, SessionLocation, SessionType } from "./protocol";

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
  sessions: Session[];
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

export type SessionStatus = "idle" | "thinking" | "compacting" | "reasoning" | "responding";

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

/** Canonical reduced state for a session at any point in time. */
export type SessionState = {
  messages: Message[];
  queuedMessages: Array<SessionMessage & { status: "queued" | "submitting" | "submitted" }>;
  model?: ModelConfiguration;
  todos: TodoItem[];
  linkedSessionIds: string[];
  canvases: SessionCanvas[];
  artifacts: string[];
  openedFiles: WorkspaceFile[];
  lastSeenEventId?: number;
  status: SessionStatus;
  reasoningContent: string;
};

export type UserMessage = {
  /** Identifies the client submission across queued, optimistic, and canonical forms. */
  clientId?: string;
  rewindable?: boolean;
  role: "user";
  content: string;
  attachments?: Attachment[];
  timestamp?: string;
};

export type SystemMessage = {
  /** Identifies the submission when the provider preserves it in history. */
  clientId?: string;
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

/** An identified user or system message submitted to a Session. */
export type SessionMessage =
  | (Omit<UserMessage, "clientId" | "rewindable" | "timestamp"> & {
      clientId: string;
      model?: ModelConfiguration;
      immediate?: true;
    })
  | (Omit<SystemMessage, "clientId" | "timestamp"> & {
      clientId: string;
      immediate?: true;
    });

/** Provider-native child activity nested under its spawning agent tool call. */
export type SubagentActivity = {
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
  subagent?: SubagentActivity;
  question?: SessionQuestion;
};

/** Build a data URL from an attachment's base64 content and MIME type. */
export function toDataUrl(attachment: Attachment): string | undefined {
  if (!attachment.base64) return undefined;
  return `data:${attachment.mimeType};base64,${attachment.base64}`;
}

export type DraftPrompt = {
  text: string;
  updatedAt: number;
  origin: string;
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
      parentToolCallId?: string;
    }
  // Deltas append verbatim; complete messages and reasoning replace their previews.
  | { type: "delta"; content: string; messageId?: string }
  | { type: "reasoning_delta"; content: string; parentToolCallId?: string }
  | { type: "reasoning"; content: string; parentToolCallId?: string }
  | {
      type: "tool_start";
      toolName: string;
      toolCallId: string;
      parentToolCallId?: string;
      arguments: { [key: string]: JSONType };
      question?: SessionQuestionBase;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      parentToolCallId?: string;
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
  | { type: "message_queued"; message: SessionMessage }
  | {
      type: "message_status_changed";
      clientId: string;
      status: "submitting" | "submitted";
    }
  | { type: "message_cancelled"; clientId: string }
  | { type: "model_changed"; model: ModelConfiguration; parentToolCallId?: string }
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

export type SessionUpdate = Pick<Session, "id"> &
  Partial<Omit<Session, "id" | "createdAt" | "updatedAt">> & {
    createdAt?: string;
    updatedAt?: string;
    worktree?: SessionWorktree;
    parentSessionId?: string;
    sessionType?: SessionType;
  };
