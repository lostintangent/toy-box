// Server-side session connection registry and lifecycle coordination.
//
// Providers persist native history; this module keeps live SessionConnection
// instances in memory, creates and resumes them with role-scoped tools, and
// coordinates lifecycle effects across runtime executions, workspace state,
// snapshots, worktrees, and provider persistence.

import {
  SessionConnectionUnavailableError,
  SessionNotFoundError,
  type SessionConnection,
} from "@providers/server/provider";
import { ensureSessionFiles, writeSessionArtifact, deleteSessionFiles } from "../artifacts";
import {
  createSession as createProviderSession,
  deleteSession as deleteProviderSession,
  resumeSession as resumeProviderSession,
} from "../providers";
import { getSessionConfiguration } from "@/server/sessionConfiguration";
import { broadcast } from "@workspace/server/events";
import { deleteSessionWorkspaceState, updateSettings } from "@workspace/server/state";
import { deleteSessionActivity } from "./activity";
import { createSessionWorktree, deleteSessionWorktree } from "./worktrees";
import { deleteSessionRecord, readSession, insertSession } from "./sessions";
import { evictCachedSnapshot } from "./snapshots";
import { detachManagedSession, resolveSessionType } from "@/server/managedSessions";
import { sharedMap } from "@/shared/server/processState";
import type { ModelConfiguration } from "@providers/model";

// Release idle native connections explicitly while preserving durable history.
const CONNECTION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type CachedConnection = {
  connection: SessionConnection;
  configurationKey?: string;
  executionLease: boolean;
  idleReleaseTimer?: ReturnType<typeof setTimeout>;
  // Join the same teardown when acquisitions and release overlap.
  disconnecting?: Promise<void>;
};
const connections = sharedMap<CachedConnection>("session-connections");
// Configuration refresh and cold resume are single-flight per session.
const acquisitions = sharedMap<Promise<SessionConnection>>("connection-acquisitions");
// Deletion waits, for at most five seconds, for an evicted connection's final history flush.
const evictions = sharedMap<Promise<void>>("connection-evictions");

export type CreateSessionOptions = {
  model?: ModelConfiguration;
  name?: string;
  directory?: string;
  useWorktree?: boolean;
  parentSessionId?: string;
};

// ── Creation ──────────────────────────────────────────────────────────

/** Claim public identity before creating any files or selecting a provider. */
export async function createSessionRecord(
  sessionId: string,
  options: {
    artifact?: { path: string; content: string };
    hyper?: true;
    title?: string;
  },
): Promise<void> {
  const artifact = options.artifact;

  const createdAt = new Date();
  const record = {
    id: sessionId,
    createdAt,
    ...(artifact ? { artifactPath: artifact.path } : {}),
  };
  await insertSession(record);
  try {
    await ensureSessionFiles(sessionId);
    if (artifact) await writeSessionArtifact(sessionId, artifact.path, artifact.content);
    if (options.hyper) await updateSettings({ hyperSessionId: sessionId });
    const { sessionType } = await resolveSessionType(sessionId);
    broadcast({
      type: "session.upserted",
      session: {
        ...record,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        title: options.title,
        sessionType,
      },
    });
  } catch (error) {
    await deleteSessionRecord(sessionId);
    throw error;
  }
}

/** Create and publish a new provider session with a caller-provided ID. */
export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
): Promise<{ connection: SessionConnection; artifactPath?: string }> {
  const requested = options ?? {};
  const model = requested.model;
  const name = requested.name;
  const useWorktree = requested.useWorktree;
  const record = await readSession(sessionId);
  const { configurationKey, ...sessionConfiguration } = await getSessionConfiguration(sessionId);
  const directory =
    "directory" in sessionConfiguration ? sessionConfiguration.directory : requested.directory;
  const worktree =
    directory && useWorktree ? await createSessionWorktree(sessionId, directory) : undefined;
  const executionDirectory = worktree?.path ?? directory;

  let created: Awaited<ReturnType<typeof createProviderSession>>;
  try {
    await ensureSessionFiles(sessionId);
    created = await createProviderSession(sessionId, {
      model,
      name,
      ...sessionConfiguration,
      directory: executionDirectory,
      artifactPath: record?.artifactPath,
    });
  } catch (error) {
    if (worktree) await deleteSessionWorktree(sessionId).catch(console.error);
    throw error;
  }
  const { connection, provider } = created;
  const now = new Date().toISOString();
  connections.set(sessionId, { connection, configurationKey, executionLease: true });

  // Publish the execution directory immediately so clients can resolve its location.
  broadcast({
    type: "session.upserted",
    session: {
      id: sessionId,
      provider,
      createdAt: record?.createdAt.toISOString() ?? now,
      updatedAt: now,
      title: name ?? "",
      context: { directory: executionDirectory },
      worktree,
      parentSessionId: requested.parentSessionId,
      sessionType: sessionConfiguration.sessionType,
    },
  });

  return {
    connection,
    ...(record?.artifactPath ? { artifactPath: record.artifactPath } : {}),
  };
}

// ── Provider connections ───────────────────────────────────────────────────────

/** Read the cached connection after any in-flight disconnect for it has settled. */
async function readCachedConnection(sessionId: string): Promise<CachedConnection | undefined> {
  const disconnecting = connections.get(sessionId)?.disconnecting;
  if (disconnecting) await disconnecting.catch(() => {});
  return connections.get(sessionId);
}

/** Acquire the connection owned by one execution, refreshing configuration when required.
 *  A resume without a configured model continues with the given one, such as its snapshot's. */
export async function acquireConnection(
  sessionId: string,
  model?: ModelConfiguration,
): Promise<SessionConnection> {
  const cached = await readCachedConnection(sessionId);
  if (cached && cached.configurationKey === undefined) {
    cancelIdleRelease(cached);
    cached.executionLease = true;
    return cached.connection;
  }

  const connection = await acquireConfiguredConnection(sessionId, cached, model);
  const acquired = connections.get(sessionId);
  if (acquired?.connection === connection) {
    cancelIdleRelease(acquired);
    acquired.executionLease = true;
  }
  return connection;
}

async function acquireConfiguredConnection(
  sessionId: string,
  cached?: CachedConnection,
  model?: ModelConfiguration,
): Promise<SessionConnection> {
  let acquisition = acquisitions.get(sessionId);
  if (!acquisition) {
    acquisition = (async () => {
      const { configurationKey, ...sessionConfiguration } =
        await getSessionConfiguration(sessionId);
      if (cached && cached.configurationKey === configurationKey) return cached.connection;

      if (cached) await disconnectConnection(sessionId, cached);
      const connection = await resumeProviderSession(sessionId, {
        ...sessionConfiguration,
        model: ("model" in sessionConfiguration ? sessionConfiguration.model : undefined) ?? model,
      });
      connections.set(sessionId, { connection, configurationKey, executionLease: false });
      return connection;
    })().finally(() => {
      acquisitions.delete(sessionId);
      const idle = connections.get(sessionId);
      if (idle) scheduleIdleRelease(sessionId, idle);
    });
    acquisitions.set(sessionId, acquisition);
  }

  return acquisition;
}

/** Release an execution-owned connection after its SessionExecution finishes. */
export function releaseConnection(sessionId: string): void {
  const cached = connections.get(sessionId);
  if (!cached) return;

  cached.executionLease = false;
  scheduleIdleRelease(sessionId, cached);
}

/** Disconnect an idle connection when a supervisor expects no immediate reuse. */
export async function releaseIdleConnection(sessionId: string): Promise<void> {
  const cached = connections.get(sessionId);
  if (cached) await releaseIfIdle(sessionId, cached);
}

/**
 * Run a short provider operation and retry once if it reveals a stale connection.
 *
 * Use this for bounded calls such as history replay, rename, and rewind, not
 * for a SessionExecution that owns one SessionConnection throughout execution. A
 * cached call retains its configuration; only execution acquisition refreshes it.
 */
export async function withConnection<T>(
  sessionId: string,
  operation: (connection: SessionConnection) => Promise<T>,
): Promise<T> {
  try {
    return await runConnectionOperation(sessionId, operation);
  } catch (error) {
    if (!evictConnectionIfStale(sessionId, error)) throw error;

    return runConnectionOperation(sessionId, operation);
  }
}

async function runConnectionOperation<T>(
  sessionId: string,
  operation: (connection: SessionConnection) => Promise<T>,
): Promise<T> {
  const cached = await readCachedConnection(sessionId);
  const connection = cached?.connection ?? (await acquireConfiguredConnection(sessionId));
  const acquired = connections.get(sessionId);
  if (acquired?.connection === connection) cancelIdleRelease(acquired);

  try {
    return await operation(connection);
  } finally {
    const current = connections.get(sessionId);
    if (current?.connection === connection) scheduleIdleRelease(sessionId, current);
  }
}

/** Drop a cached connection so the next access resumes fresh instead of reusing it. */
export function evictConnection(sessionId: string): void {
  const cached = connections.get(sessionId);
  if (!cached) return;
  connections.delete(sessionId);
  const eviction = Promise.race([
    disconnectConnection(sessionId, cached).catch(console.error),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref()),
  ]);
  evictions.set(sessionId, eviction);
  void eviction.then(() => {
    if (evictions.get(sessionId) === eviction) evictions.delete(sessionId);
  });
}

/** Drop a cached connection when an error says the provider no longer knows
 *  the session, so the next access resumes fresh instead of reusing a stale
 *  connection. Returns whether the error was a stale-connection error. */
export function evictConnectionIfStale(sessionId: string, error: unknown): boolean {
  const stale =
    error instanceof SessionConnectionUnavailableError || error instanceof SessionNotFoundError;
  if (!stale) return false;

  evictConnection(sessionId);
  return true;
}

/** Rename a session through its provider and broadcast the updated display name. */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await withConnection(sessionId, (connection) => connection.rename(name));
  broadcast({ type: "session.upserted", session: { id: sessionId, title: name } });
}

/** Update an inferred title without replacing a name explicitly assigned by its creator or user. */
export async function updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
  const applied = await withConnection(sessionId, (connection) => connection.rename(title, true));
  if (applied) broadcast({ type: "session.upserted", session: { id: sessionId, title } });
  return applied;
}

// ── Deletion ───────────────────────────────────────────────────────────

/** Delete a session's connection, provider history, and state once its runtime is gone. */
export async function deleteSessionResources(
  sessionId: string,
  options?: { publish?: boolean },
): Promise<void> {
  // Native teardown can flush history; it must finish before history is deleted.
  const cached = connections.get(sessionId);
  if (cached) await disconnectConnection(sessionId, cached);
  await evictions.get(sessionId);
  const record = await readSession(sessionId);
  if (!record || record.provider) await deleteProviderSession(sessionId);
  await removeDeletedSessionState(sessionId, options);
}

/** Delete a session's state, including when its provider history is already gone. */
export async function removeDeletedSessionState(
  sessionId: string,
  { publish = true }: { publish?: boolean } = {},
): Promise<void> {
  await deleteSessionWorktree(sessionId);
  await deleteSessionFiles(sessionId);
  await deleteSessionRecord(sessionId);
  await detachManagedSession(sessionId);
  deleteSessionActivity(sessionId);
  evictCachedSnapshot(sessionId);
  // Publish first so other clients drop the session before its pin or Hyper setting clears.
  if (publish) broadcast({ type: "session.deleted", sessionId });
  await deleteSessionWorkspaceState(sessionId);
}

// ── Helpers ────────────────────────────────────────────────────────────

async function releaseIfIdle(sessionId: string, cached: CachedConnection): Promise<void> {
  if (
    connections.get(sessionId) !== cached ||
    cached.executionLease ||
    acquisitions.has(sessionId)
  ) {
    return;
  }

  await disconnectConnection(sessionId, cached);
}

function scheduleIdleRelease(sessionId: string, cached: CachedConnection): void {
  cancelIdleRelease(cached);
  if (cached.executionLease || cached.disconnecting) return;

  cached.idleReleaseTimer = setTimeout(() => {
    cached.idleReleaseTimer = undefined;
    void releaseIfIdle(sessionId, cached).catch((error) => {
      console.error(`Unable to release the idle connection for ${sessionId}:`, error);
    });
  }, CONNECTION_IDLE_TIMEOUT_MS);
  cached.idleReleaseTimer.unref();
}

function cancelIdleRelease(cached: CachedConnection): void {
  if (!cached.idleReleaseTimer) return;
  clearTimeout(cached.idleReleaseTimer);
  cached.idleReleaseTimer = undefined;
}

function disconnectConnection(sessionId: string, cached: CachedConnection): Promise<void> {
  if (cached.disconnecting) return cached.disconnecting;

  cancelIdleRelease(cached);
  const disconnecting = cached.connection.disconnect().then(
    () => {
      if (connections.get(sessionId) === cached) connections.delete(sessionId);
    },
    (error) => {
      if (connections.get(sessionId) === cached) {
        cached.disconnecting = undefined;
        scheduleIdleRelease(sessionId, cached);
      }
      throw error;
    },
  );
  cached.disconnecting = disconnecting;
  return disconnecting;
}
