// Server function definitions for session management
// These are the RPC boundary — safe to import from anywhere

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { RawStream } from "@tanstack/router-core";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listAllSessions, listAvailableModels } from "./sdk/client";
import { getOrResumeSession, deleteSession } from "./state/sessionCache";
import { getUnreadSessionIds, markSessionUnread, markSessionRead } from "./state/unread";
import { readAttachment } from "./state/attachments";
import { SessionStream, createSessionEventStream } from "./runtime/stream";
import type {
  Attachment,
  Message,
  ModelInfo,
  SessionEvent,
  SessionMetadata,
  SessionSnapshot,
  SessionStatus,
} from "@/types";
import { applySessionEvent, createInitialSession } from "@/lib/session/sessionReducer";
import { projectSessionEventsFromSdkHistory } from "@/functions/sdk/projector";
import { encodeSessionEvent } from "@/lib/session/streamCodec";

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

const sessionInputSchema = z.object({
  sessionId: z.string(),
});

const streamInputSchema = z.object({
  sessionId: z.string(),
  prompt: z.string().optional(),
  clientMessageId: z.string().optional(),
  afterEventId: z.number().int().nonnegative().optional(),
  attachments: z
    .array(
      z.object({
        displayName: z.string(),
        mimeType: z.string(),
        base64: z.string().optional(),
      }),
    )
    .optional(),
  // For draft sessions: create the session on first message instead of resuming
  startNew: z.boolean().optional(),
  model: z.string().optional(),
  directory: z.string().optional(),
});

const enqueueInputSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
  queuedMessageId: z.string().optional(),
  attachments: z
    .array(
      z.object({
        displayName: z.string(),
        mimeType: z.string(),
        base64: z.string().optional(),
      }),
    )
    .optional(),
});

const cancelQueuedInputSchema = z.object({
  sessionId: z.string(),
  queuedMessageId: z.string(),
});

const sessionsBootstrapInputSchema = z
  .object({
    openSessionIds: z.array(z.string()).max(4).optional(),
  })
  .default({});

// ============================================================================
// Middleware
// ============================================================================

/** Middleware that validates sessionId input - reused across multiple server functions */
const withSessionId = createMiddleware({ type: "function" }).inputValidator(
  zodValidator(sessionInputSchema),
);

async function readHistoryAttachments(attachments: unknown): Promise<Attachment[] | undefined> {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;

  return Promise.all(
    attachments.map((attachment) =>
      readAttachment(attachment as { displayName?: string; path?: string; filePath?: string }),
    ),
  );
}

// ============================================================================
// Server Functions
// ============================================================================

export type SessionsBootstrapState = {
  sessions: SessionMetadata[];
  streamingSessionIds: string[];
  unreadSessionIds: string[];
};

/** Fetch list + streaming + unread state in a single round-trip */
export const getSessionsBootstrapState = createServerFn({ method: "GET" })
  .inputValidator(zodValidator(sessionsBootstrapInputSchema))
  .handler(async ({ data }): Promise<SessionsBootstrapState> => {
    for (const sessionId of new Set(data.openSessionIds ?? [])) {
      markSessionRead(sessionId);
    }

    const sessions = await listAllSessions();

    return {
      sessions,
      streamingSessionIds: SessionStream.getRunningSessionIds(),
      unreadSessionIds: getUnreadSessionIds(),
    };
  });

/** Mark a session as read */
export const markSessionAsRead = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => {
    markSessionRead(data.sessionId);
    return { success: true };
  });

/** Mark a session as unread */
export const markSessionAsUnread = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => {
    markSessionUnread(data.sessionId);
    return { success: true };
  });

/** List available models */
export const listModels = createServerFn({ method: "GET" }).handler(
  async (): Promise<ModelInfo[]> => {
    return listAvailableModels();
  },
);

/**
 * When merging SDK history with streaming data, the SDK may already include
 * events from the in-progress turn (user message, completed sub-turn messages).
 * The streaming snapshot/buffer covers that same turn, so we truncate the
 * history at the turn boundary to avoid duplicating messages.
 */
function truncateAtCurrentTurn(
  historyMessages: Message[],
  streamingMessages: Message[],
): Message[] {
  if (streamingMessages.length === 0 || streamingMessages[0].role !== "user") {
    return historyMessages;
  }

  let lastUserIdx = -1;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    if (historyMessages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return historyMessages;
  return historyMessages.slice(0, lastUserIdx);
}

/** Resume a session and get its message history */
export const querySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<SessionSnapshot> => {
    const { session, events } = await getOrResumeSession(data.sessionId);

    const sessionState = createInitialSession();
    for await (const event of projectSessionEventsFromSdkHistory(events, {
      resolveAttachments: ({ data }) => readHistoryAttachments(data?.attachments),
    })) {
      applySessionEvent(sessionState, event);
    }

    const stream = SessionStream.get(data.sessionId);
    const streamState = stream?.getTurnState();

    let messages = sessionState.messages;
    let model = sessionState.model;
    let streamingTodos = sessionState.todos;
    let status: SessionStatus = sessionState.status;
    let reasoningContent = "";
    if (streamState) {
      messages = truncateAtCurrentTurn(messages, streamState.messages);
      messages = [...messages, ...streamState.messages];
      model = streamState.model ?? model;
      streamingTodos = streamState.todos ?? streamingTodos;
      status = streamState.status;
      reasoningContent = streamState.reasoningContent;
    }

    // Queued messages are stored on the stream (not in SDK event history)
    // so they can survive client navigation and be cancelled by the user.
    const queuedMessages = stream?.getQueuedMessages() ?? [];

    return {
      id: session.sessionId,
      messages,
      queuedMessages,
      model,
      todos: streamingTodos,
      lastSeenEventId: stream?.getLastEventId(),
      status,
      reasoningContent,
    };
  });

function createEventByteStream(iterator: AsyncGenerator<SessionEvent>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encodeSessionEvent(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

export const connectSessionStream = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(streamInputSchema))
  .handler(async ({ data }) => {
    const iterator = createSessionEventStream(data);
    return new RawStream(createEventByteStream(iterator), { hint: "text" });
  });

/** Enqueue a message to be sent after the current turn finishes.
 *  Stored on the stream so it survives client navigation and can be cancelled. */
export const enqueueMessage = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(enqueueInputSchema))
  .handler(async ({ data }) => {
    const stream = SessionStream.get(data.sessionId);
    if (!stream) return { success: false };

    stream.addQueuedMessage({
      id: data.queuedMessageId,
      role: "user",
      content: data.content,
      attachments: data.attachments,
    });
    return { success: true };
  });

/** Cancel a queued message by ID (before it's been sent to the SDK) */
export const cancelQueuedMessage = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(cancelQueuedInputSchema))
  .handler(async ({ data }) => {
    const stream = SessionStream.get(data.sessionId);
    const removed = stream?.removeQueuedMessage(data.queuedMessageId) ?? false;
    return { success: removed };
  });

/** Abort the currently processing message in a session.
 *  Closes the stream (which clears buffer, queue, and SDK listener). */
export const abortSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => {
    const stream = SessionStream.get(data.sessionId);
    if (stream) {
      await stream.abort();
    }
    return { success: true };
  });

/** Destroy a session and release resources */
export const destroySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => {
    SessionStream.close(data.sessionId);
    await deleteSession(data.sessionId);
    return { success: true };
  });
