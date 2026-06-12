// Server function definitions for session management
// These are the RPC boundary — safe to import from anywhere

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { RawStream } from "@tanstack/router-core";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listAllSessions, listAvailableModels } from "./sdk/client";
import { getOrResumeSession, getCachedOrResumeSession, deleteSession } from "./state/sessionCache";
import { getUnreadSessionIds, markSessionUnread, markSessionRead } from "./state/unread";
import {
  getAllSessionWorktrees,
  getSessionWorktree,
  deleteSessionWorktree,
} from "./state/worktreeMetadata";
import { getChildSessionIds } from "./state/childSessions";
import { SessionStream, createSessionEventStream } from "./runtime/stream";
import {
  cleanupWorktree,
  mergeWorktreeBranch,
  applyWorktreeBranch,
  detectGitRoot,
} from "./worktrees";
import type {
  ModelInfo,
  SessionEvent,
  SessionMetadata,
  SessionSkill,
  SessionSnapshot,
  SessionWorktree,
} from "@/types";
import { toSessionSnapshot } from "@/lib/session/sessionReducer";
import { initializeSessionStateFromSdkHistory } from "@/functions/sdk/historyReplay";
import { encodeSessionEvent } from "@/lib/session/streamCodec";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

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
        base64: z.string(),
      }),
    )
    .optional(),
  // For draft sessions: create the session on first message instead of resuming
  startNew: z.boolean().optional(),
  modelConfiguration: modelConfigurationSchema.optional(),
  directory: z.string().optional(),
  useWorktree: z.boolean().optional(),
});

const enqueueInputSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
  queuedMessageId: z.string().optional(),
  modelConfiguration: modelConfigurationSchema.optional(),
  attachments: z
    .array(
      z.object({
        displayName: z.string(),
        mimeType: z.string(),
        base64: z.string(),
      }),
    )
    .optional(),
});

const cancelQueuedInputSchema = z.object({
  sessionId: z.string(),
  queuedMessageId: z.string(),
});

const sessionsStateInputSchema = z
  .object({
    openSessionIds: z.array(z.string()).max(4).optional(),
  })
  .default({});

// ============================================================================
// Middleware
// ============================================================================

/** Middleware that validates sessionId input - reused across multiple server functions */
const withSessionId = createMiddleware({ type: "function" }).validator(
  zodValidator(sessionInputSchema),
);

// ============================================================================
// Server Functions
// ============================================================================

export type SessionsState = {
  sessions: SessionMetadata[];
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  worktrees: Record<string, SessionWorktree>;
  childSessionIds: string[];
};

/** Fetch list + streaming + unread + app metadata in a single round-trip */
export const getSessionsState = createServerFn({ method: "GET" })
  .validator(zodValidator(sessionsStateInputSchema))
  .handler(async ({ data }): Promise<SessionsState> => {
    for (const sessionId of new Set(data.openSessionIds ?? [])) {
      markSessionRead(sessionId);
    }

    const [sessions, worktrees, childSessionIds] = await Promise.all([
      listAllSessions(),
      getAllSessionWorktrees(),
      getChildSessionIds(),
    ]);

    return {
      sessions,
      streamingSessionIds: SessionStream.getRunningSessionIds(),
      unreadSessionIds: getUnreadSessionIds(),
      worktrees,
      childSessionIds,
    };
  });

/** Mark a session as read */
export const markSessionAsRead = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    markSessionRead(data.sessionId);
    return true;
  });

/** Mark a session as unread */
export const markSessionAsUnread = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    markSessionUnread(data.sessionId);
    return true;
  });

/** List available models */
export const listModels = createServerFn({ method: "GET" }).handler(
  async (): Promise<ModelInfo[]> => {
    return listAvailableModels();
  },
);

/** List user-invocable skills for a session (directory-scoped, cached on client by CWD) */
export const listSessionSkills = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<SessionSkill[]> => {
    const session = await getCachedOrResumeSession(data.sessionId);
    const result = await session.rpc.skills.list();
    return result.skills
      .filter((s) => s.userInvocable && s.enabled)
      .map((s) => ({ name: s.name, description: s.description }));
  });

/** Resume a session and get its message history */
export const querySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<SessionSnapshot> => {
    const stream = SessionStream.get(data.sessionId);
    if (stream) {
      return toSessionSnapshot(data.sessionId, stream.getSessionState());
    }

    const { session, events } = await getOrResumeSession(data.sessionId);
    return toSessionSnapshot(session.sessionId, await initializeSessionStateFromSdkHistory(events));
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
  .validator(zodValidator(streamInputSchema))
  .handler(async ({ data }) => {
    const iterator = createSessionEventStream(data);
    return new RawStream(createEventByteStream(iterator), { hint: "text" });
  });

/** Enqueue a message to be sent after the current turn finishes.
 *  Stored on the stream so it survives client navigation and can be cancelled. */
export const enqueueMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(enqueueInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    if (!stream) return false;

    stream.addQueuedMessage({
      id: data.queuedMessageId,
      role: "user",
      content: data.content,
      attachments: data.attachments,
      modelConfiguration: data.modelConfiguration,
    });
    return true;
  });

/** Cancel a queued message by ID (before it's been sent to the SDK) */
export const cancelQueuedMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(cancelQueuedInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    return stream?.removeQueuedMessage(data.queuedMessageId) ?? false;
  });

/** Abort the currently processing message in a session.
 *  Closes the stream (which clears buffer, queue, and SDK listener). */
export const abortSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    if (stream) {
      await stream.abort();
    }
    return true;
  });

/** Destroy a session and release resources */
export const destroySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    SessionStream.close(data.sessionId);
    await deleteSession(data.sessionId);
    return true;
  });

/**
 * Resolve and validate a worktree session's metadata + git root, then run the
 * given callback. Returns `{ status: "no-worktree" }` if the session has no
 * worktree. On success, cleans up the worktree automatically.
 */
async function withWorktreeSession<T extends { status: string }>(
  sessionId: string,
  action: (gitRoot: string, info: { branch: string; baseBranch: string }) => Promise<T>,
  successStatus: T["status"],
): Promise<T | { status: "no-worktree" }> {
  const worktree = await getSessionWorktree(sessionId);
  if (!worktree?.path || !worktree.branch || !worktree.baseBranch) {
    return { status: "no-worktree" as const };
  }
  const gitRoot = await detectGitRoot(worktree.path);
  if (!gitRoot) return { status: "no-worktree" as const };

  const result = await action(gitRoot, {
    branch: worktree.branch,
    baseBranch: worktree.baseBranch,
  });

  // Clean up the worktree + record after a successful operation
  if (result.status === successStatus) {
    await cleanupWorktree({
      path: worktree.path,
      branch: worktree.branch,
    }).catch(console.error);
    await deleteSessionWorktree(sessionId);
  }

  return result;
}

/** Merge a worktree session's changes back into its base branch */
export const mergeSessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => withWorktreeSession(data.sessionId, mergeWorktreeBranch, "merged"));

/** Apply a worktree session's changes to its base branch as uncommitted modifications */
export const applySessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => withWorktreeSession(data.sessionId, applyWorktreeBranch, "applied"));
