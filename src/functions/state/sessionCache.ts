// CopilotSession object cache and session lifecycle orchestration.
//
// The SDK persists sessions to disk; this module caches live
// CopilotSession objects in memory to avoid redundant resume calls.
// It also owns the deleteSession workflow, which coordinates cleanup
// across streaming buffers, unread state, attachments, and SDK
// persistence.

import type { CopilotSession } from "@github/copilot-sdk";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  deleteSession as sdkDeleteSession,
  readSessionContextFromEvents,
} from "../sdk/client";
import { emitSessionUpsert, emitSessionDelete } from "../runtime/broadcast";
import { SessionStream } from "../runtime/stream";
import { deleteUnreadState } from "./unread";
import { cleanupSessionAttachments } from "./attachments";

const activeSessions = new Map<string, CopilotSession>();

/** Create a new session with a specific ID and cache it (for draft sessions) */
export async function createSession(
  sessionId: string,
  model?: string,
  directory?: string,
): Promise<CopilotSession> {
  const session = await sdkCreateSession(sessionId, model, directory);
  const now = new Date().toISOString();
  activeSessions.set(sessionId, session);

  const effectiveDirectory = directory ?? process.cwd();

  // Emit immediately with just cwd so the session appears in the list right away,
  // then backfill full context (gitRoot, repository, branch) from the SDK's
  // session.start event once it's written to disk.
  emitSessionUpsert({
    sessionId,
    startTime: now,
    modifiedTime: now,
    summary: "",
    isRemote: false,
    context: { cwd: effectiveDirectory },
  });

  readSessionContextFromEvents(sessionId).then((context) => {
    if (context) {
      emitSessionUpsert({ sessionId, context });
    }
  });
  return session;
}

/** Get a cached session or resume it from SDK persistence */
async function getCachedOrResumeSession(sessionId: string): Promise<CopilotSession> {
  const cached = activeSessions.get(sessionId);
  if (cached) return cached;

  const session = await sdkResumeSession(sessionId);
  activeSessions.set(sessionId, session);
  return session;
}

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("session file not found")
  );
}

/** Resume a session and fetch its messages, retrying once if the cached session is stale */
export async function getOrResumeSession(sessionId: string): Promise<{
  session: CopilotSession;
  events: Awaited<ReturnType<CopilotSession["getMessages"]>>;
}> {
  let session = await getCachedOrResumeSession(sessionId);
  try {
    const events = await session.getMessages();
    return { session, events };
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    evictCachedSession(sessionId);

    session = await getCachedOrResumeSession(sessionId);
    const events = await session.getMessages();
    return { session, events };
  }
}

/** Remove a cached session so the next access forces a resume */
export function evictCachedSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

/** Check whether a session currently has a cached live SDK session object. */
export function hasCachedSession(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/** Delete a session (cache + streaming + unread + attachments + SDK persistence) */
export async function deleteSession(sessionId: string): Promise<void> {
  const cached = activeSessions.get(sessionId);
  if (cached) {
    await cached.destroy();
    activeSessions.delete(sessionId);
  }

  SessionStream.remove(sessionId);
  deleteUnreadState(sessionId);

  await cleanupSessionAttachments(sessionId);
  await sdkDeleteSession(sessionId);
  emitSessionDelete(sessionId);
}
