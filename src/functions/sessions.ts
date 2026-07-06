// Server function definitions for session management
// These are the RPC boundary — safe to import from anywhere

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { RawStream } from "@tanstack/router-core";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listAllSessions, listAvailableModels } from "./sdk/client";
import * as sessionRegistry from "./state/sessionRegistry";
import { loadSessionSnapshot } from "./state/snapshotCache";
import {
  applyWorkspaceAction,
  clearDraftPrompt,
  getWorkspaceState as readWorkspaceState,
  loadCustomArtifacts,
  sweepExpiredDrafts,
} from "./state/workspace";
import {
  getAllSessionWorktrees,
  getSessionWorktree,
  deleteSessionWorktree,
} from "./state/worktreeMetadata";
import { getChildSessionIds } from "./state/childSessions";
import { deliverSessionMessage, SessionStream, connectClientStream } from "./runtime/stream";
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
import type { WorkspaceState } from "@/lib/workspace/state";
import { agentNotificationSchema } from "@/lib/session/agentNotifications";
import { toSessionSnapshot } from "@/lib/session/sessionReducer";
import { encodeSessionEvent } from "@/lib/session/streamCodec";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

const sessionInputSchema = z.object({
  sessionId: z.string(),
});

const renameSessionInputSchema = z.object({
  sessionId: z.string(),
  name: z.string().trim().min(1).max(100),
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

const deliverMessageInputSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
  clientMessageId: z.string().optional(),
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

const notifyAgentInputSchema = z.object({
  sessionId: z.string(),
  notification: agentNotificationSchema,
});

const cancelQueuedInputSchema = z.object({
  sessionId: z.string(),
  queuedMessageId: z.string(),
});

const draftSessionSchema = z.object({
  sessionId: z.string().startsWith(SESSION_ID_PREFIX),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const draftPromptSchema = z.object({
  text: z.string().max(64 * 1024),
  updatedAt: z.number(),
  origin: z.string().min(1).max(128),
});

const workspaceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.draft.created"),
    draft: draftSessionSchema,
  }),
  z.object({
    type: z.literal("session.draft.discarded"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("session.prompt.drafted"),
    sessionId: z.string(),
    prompt: draftPromptSchema,
  }),
  z.object({
    type: z.literal("session.hyper.created"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("session.hyper.promoted"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("session.read"),
    sessionId: z.string(),
  }),
]);

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
  worktrees: Record<string, SessionWorktree>;
  childSessionIds: string[];
};

/** Fetch durable session list metadata in a single round-trip. */
export const getSessionsState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionsState> => {
    const [sessions, worktrees, childSessionIds] = await Promise.all([
      listAllSessions(),
      getAllSessionWorktrees(),
      getChildSessionIds(),
    ]);

    return {
      sessions,
      worktrees,
      childSessionIds,
    };
  },
);

export const getWorkspaceState = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceState> => {
    sweepExpiredDrafts();
    const customArtifacts = await loadCustomArtifacts();
    return readWorkspaceState({
      runningSessionIds: SessionStream.getRunningSessionIds(),
      customArtifacts,
    });
  },
);

export const dispatchWorkspaceAction = createServerFn({ method: "POST" })
  .validator(zodValidator(workspaceActionSchema))
  .handler(async ({ data }): Promise<void> => {
    applyWorkspaceAction(data);
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
    const result = await sessionRegistry.withSession(data.sessionId, (session) =>
      session.rpc.skills.list(),
    );
    return result.skills
      .filter((s) => s.userInvocable && s.enabled)
      .map((s) => ({ name: s.name, description: s.description }));
  });

/** A session's reduced transcript snapshot, served from the cheapest source
 *  that is still truthful: the live stream's in-memory state, then the
 *  cold-path ladder (snapshot cache, then SDK resume + full history replay,
 *  which repopulates the cache for the next open). */
export const querySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<SessionSnapshot> => {
    const stream = SessionStream.get(data.sessionId);
    if (stream) {
      return toSessionSnapshot(data.sessionId, stream.getSessionState());
    }

    return loadSessionSnapshot(data.sessionId);
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
        // Expected runtime failures are emitted as session end/error events.
        // Reaching the transport error path means the adapter itself failed.
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

export const connectSessionStream = createServerFn({ method: "POST" })
  .validator(zodValidator(streamInputSchema))
  .handler(async ({ data }) => {
    const iterator = connectClientStream({
      ...data,
      onDelivered: () => clearDraftPrompt(data.sessionId),
    });
    return new RawStream(createEventByteStream(iterator), { hint: "text" });
  });

/** Deliver a follow-up message. The runtime decides whether it sends now or queues. */
export const deliverMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(deliverMessageInputSchema))
  .handler(async ({ data }): Promise<{ disposition: "sent" | "queued" }> => {
    const receipt = await deliverSessionMessage({
      sessionId: data.sessionId,
      message: {
        id: data.clientMessageId ?? crypto.randomUUID(),
        role: "user",
        content: data.content,
        attachments: data.attachments,
        modelConfiguration: data.modelConfiguration,
      },
    });
    clearDraftPrompt(data.sessionId);
    return { disposition: receipt.disposition };
  });

/** Notify a session's agent over the side channel. Active sessions queue it
 *  (coalescing equivalents); idle historical sessions are resumed and processed. */
export const notifyAgent = createServerFn({ method: "POST" })
  .validator(zodValidator(notifyAgentInputSchema))
  .handler(async ({ data }): Promise<void> => {
    await deliverSessionMessage({
      sessionId: data.sessionId,
      message: {
        id: crypto.randomUUID(),
        role: "agent_notification",
        notification: data.notification,
      },
    });
  });

/** Cancel a queued message by ID (before it's been sent to the SDK) */
export const cancelQueuedMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(cancelQueuedInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    return stream?.cancelQueuedMessage(data.queuedMessageId) ?? false;
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

/** Delete a session and release resources */
export const deleteSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    await sessionRegistry.deleteSession(data.sessionId);
    return true;
  });

/** Rename a session using the SDK's persisted friendly-name metadata. */
export const renameSession = createServerFn({ method: "POST" })
  .validator(zodValidator(renameSessionInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    await sessionRegistry.renameSession(data.sessionId, data.name);
    return true;
  });

/**
 * Resolve and validate a worktree session's metadata + git root, then run the
 * given callback. Successful operations clean up the worktree automatically;
 * failures throw so the client can treat them as unresolved conflicts.
 */
async function withWorktreeSession(
  sessionId: string,
  action: (gitRoot: string, info: { branch: string; baseBranch: string }) => Promise<void>,
): Promise<void> {
  const worktree = await getSessionWorktree(sessionId);
  if (!worktree) return;

  const gitRoot = await detectGitRoot(worktree.path);
  if (!gitRoot) return;

  await action(gitRoot, {
    branch: worktree.branch,
    baseBranch: worktree.baseBranch,
  });

  await cleanupWorktree({
    path: worktree.path,
    branch: worktree.branch,
  }).catch(console.error);
  await deleteSessionWorktree(sessionId);
}

/** Merge a worktree session's changes back into its base branch */
export const mergeSessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => withWorktreeSession(data.sessionId, mergeWorktreeBranch));

/** Apply a worktree session's changes to its base branch as uncommitted modifications */
export const applySessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => withWorktreeSession(data.sessionId, applyWorktreeBranch));
