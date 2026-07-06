/**
 * Client facade for one session's live state.
 *
 * The hook speaks the UI register: send messages, attach/detach from the
 * stream, stop in-flight work, cancel queued prompts, and sync snapshots.
 * Server functions keep the domain register underneath: connect, deliver,
 * abort, and cancel queue entries.
 *
 * Session creation: a draft session (see useDrafts) stays a draft until its
 * first send, which asks the server to create the persisted session (`startNew`,
 * plus creation-time options like directory and worktree). Once the server
 * confirms the persisted session exists, this hook marks the draft as present
 * in durable session-list state and removes its draft membership locally.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectSessionStream,
  abortSession,
  deliverMessage,
  cancelQueuedMessage as serverCancelQueuedMessage,
} from "@/functions/sessions";
import type {
  Attachment,
  DraftSession,
  ModelConfiguration,
  SessionEvent,
  SessionMetadataUpdate,
  SessionSnapshot,
  SessionStatus,
} from "@/types";
import {
  applySessionEvent,
  createInitialSession,
  toSessionSnapshot,
  type Session,
} from "@/lib/session/sessionReducer";
import { sessionQueries, skillQueries } from "@/lib/queries";
import { decodeSessionEvents } from "@/lib/session/streamCodec";
import { useWorkspaceContext } from "@/hooks/workspace/context";
import { generateUUID } from "@/lib/utils";

const THINKING_STATUS: SessionStatus = "thinking";

type StreamLoopOutcome = "completed" | "aborted" | "failed";
type SessionStreamData = Parameters<typeof connectSessionStream>[0]["data"];

async function fetchSessionEventStream(
  data: SessionStreamData,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const raw = await connectSessionStream({ data, signal });
  return raw as unknown as ReadableStream<Uint8Array>;
}

function isAbortError(error: unknown): boolean {
  if (!(typeof error === "object" && error !== null)) return false;

  if ("name" in error && (error as { name?: unknown }).name === "AbortError") {
    return true;
  }

  return (
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.includes("BodyStreamBuffer was aborted")
  );
}

type SendMessageOptions = {
  directory?: string;
};

function draftToSessionUpdate(sessionId: string, draft?: DraftSession): SessionMetadataUpdate {
  return {
    sessionId,
    ...(draft
      ? {
          startTime: new Date(draft.createdAt).toISOString(),
          modifiedTime: new Date(draft.updatedAt).toISOString(),
        }
      : {}),
  };
}

export interface SessionConfig {
  /** True while this ID is a draft that has not produced a persisted session yet. */
  isDraftSession?: boolean;
  /** Global picker state, used to seed a draft's first message. Once the session
   *  has its own configuration (seeded on send, or synced from the server), that
   *  always wins over this default. */
  defaultModelConfiguration?: ModelConfiguration;
  /** Working directory for the session. Only sent with a draft's first message
   *  (the server fixes it at creation). */
  directory?: string;
  /** Run the session in an isolated git worktree. Creation-time only, like
   *  `directory`. */
  useWorktree?: boolean;
  /** Draft metadata used for the local draft-to-session handoff after first send. */
  draftSession?: DraftSession;
}

export function useSession(sessionId: string, sessionConfig?: SessionConfig) {
  const queryClient = useQueryClient();
  const { applyWorkspaceEvent } = useWorkspaceContext();
  const sessionSnapshotQueryKey = sessionQueries.detail(sessionId).queryKey;
  const isDraftSession = !!sessionConfig?.isDraftSession;
  const defaultModelConfiguration = sessionConfig?.defaultModelConfiguration;
  const sessionDirectory = sessionConfig?.directory;
  const sessionUseWorktree = sessionConfig?.useWorktree;
  const draftSession = sessionConfig?.draftSession;

  // ---------------------------------------------------------------------------
  // Query cache helpers
  // ---------------------------------------------------------------------------
  const setCachedSessionSnapshot = useCallback(
    (state: Session) => {
      // Keep the session snapshot in sync with the live stream so reenabling
      // the query after streaming does not briefly replay stale linked-session state.
      queryClient.setQueryData<SessionSnapshot>(sessionSnapshotQueryKey, (old) =>
        toSessionSnapshot(sessionId, state, old),
      );
    },
    [queryClient, sessionSnapshotQueryKey, sessionId],
  );

  const invalidateSessionSnapshot = useCallback(
    () => queryClient.invalidateQueries({ queryKey: sessionSnapshotQueryKey }),
    [queryClient, sessionSnapshotQueryKey],
  );

  // ---------------------------------------------------------------------------
  // Core State: mutable ref + revision counter for batched rendering
  // ---------------------------------------------------------------------------
  // Session state lives in a mutable ref so streaming events can mutate it
  // without triggering a React render on every delta. A separate `revision`
  // counter drives rendering and is bumped either immediately (for discrete
  // events like tool calls) or once per animation frame (for high-frequency
  // text/reasoning deltas during streaming).
  const sessionRef = useRef<{ sessionId: string; state: Session } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  if (!sessionRef.current || sessionRef.current.sessionId !== sessionId) {
    sessionRef.current = {
      sessionId,
      state: createInitialSession(),
    };
  }

  // Draft status controls whether the next send creates the persisted session.
  // Once a draft creates one, or an existing session is identified, the latch
  // only moves to true so a mid-stream list update cannot send `startNew` twice.
  const persistedSessionRef = useRef<{ sessionId: string; exists: boolean } | null>(null);
  if (!persistedSessionRef.current || persistedSessionRef.current.sessionId !== sessionId) {
    persistedSessionRef.current = { sessionId, exists: !isDraftSession };
  } else if (!isDraftSession) {
    persistedSessionRef.current.exists = true;
  }

  // A revision counter that triggers React re-renders. Incrementing this is
  // how we tell React "the mutable state in sessionRef has changed, re-read it."
  // For high-frequency streaming deltas, the increment is deferred to the next
  // animation frame so multiple mutations coalesce into a single render.
  const [revision, setRevision] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasLoadedSessionState, setHasLoadedSessionState] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Flush any pending batched update and notify React of the state change. */
  const updateRevision = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setRevision((r) => r + 1);
  }, []);

  /** Schedule a revision update on the next animation frame (coalesces rapid updates). */
  const scheduleRevision = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      updateRevision();
    });
  }, [updateRevision]);

  const {
    messages,
    queuedMessages,
    todos,
    linkedSessionIds,
    canvases,
    artifacts,
    status: baseStatus,
    reasoningContent,
    modelConfiguration,
  } = sessionRef.current.state;

  // During connection handshake we still want a spinner even if no events arrived yet.
  const status = isStreaming && baseStatus === "idle" ? THINKING_STATUS : baseStatus;

  useEffect(() => {
    setHasLoadedSessionState(false);
    return () => {
      abortControllerRef.current?.abort();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [sessionId]);

  // ---------------------------------------------------------------------------
  // Event application: mutate state + update/schedule revision
  // ---------------------------------------------------------------------------
  const applyEvent = useCallback(
    (event: SessionEvent) => {
      // Skills are directory-scoped — prime the React Query cache so all
      // sessions in the same CWD share the data without an extra RPC call.
      if (event.type === "skills" && sessionDirectory) {
        queryClient.setQueryData(skillQueries.byCwd(sessionDirectory), event.skills);
      }

      applySessionEvent(sessionRef.current!.state, event);

      if (event.type === "delta" || event.type === "reasoning") {
        scheduleRevision();
      } else {
        updateRevision();
      }
    },
    [queryClient, scheduleRevision, sessionDirectory, updateRevision],
  );

  // ---------------------------------------------------------------------------
  // Streaming: Core loop used by both sendMessage and attachToStream
  // ---------------------------------------------------------------------------
  const runStreamingLoop = useCallback(
    async (
      streamData: SessionStreamData,
      callbacks?: {
        onStarted?: () => void;
        onFirstEvent?: () => void;
        onSuccess?: () => void;
      },
    ): Promise<StreamLoopOutcome> => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);

      let receivedData = false;
      let outcome: StreamLoopOutcome = "failed";

      try {
        const stream = await fetchSessionEventStream(streamData, controller.signal);
        const eventStream = decodeSessionEvents(stream);
        callbacks?.onStarted?.();

        for await (const event of eventStream) {
          if (controller.signal.aborted) break;
          if (!receivedData) {
            receivedData = true;
            callbacks?.onFirstEvent?.();
          }
          applyEvent(event);
        }

        if (!controller.signal.aborted) {
          callbacks?.onSuccess?.();
        }
        outcome = controller.signal.aborted ? "aborted" : "completed";
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          outcome = "aborted";
        } else {
          outcome = "failed";
          throw error;
        }
      } finally {
        // Real runtime streams publish `end` from the server. This fallback is
        // only for event-less completions, such as queueing behind another live turn.
        if (outcome === "completed" && !receivedData) {
          applyEvent({ type: "end", reason: "idle" });
        }
        if (outcome === "completed") {
          setCachedSessionSnapshot(sessionRef.current!.state);
          // Do not clear the workspace running projection here. The runtime
          // broadcasts session.idle when the turn truly ends (stream
          // #finishStream) — that is the authority. A passive/event-less subscribe
          // from a second instance on the same session (e.g. the overlay) also
          // completes here without having observed the turn, and clearing running
          // then would clobber a sibling that is still streaming it.
        }
        setIsStreaming(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }

      return outcome;
    },
    [applyEvent, setCachedSessionSnapshot],
  );

  // End streaming locally (used when detaching or stopping). The transient-state
  // reset goes through the reducer event path so local and server terminal
  // cleanup cannot drift.
  //
  // Deliberately does NOT touch the workspace running projection: background
  // detach (page hidden) leaves the session running server-side, so clearing
  // running here would wrongly show it idle. Explicit user stop clears running
  // in stopStream instead.
  const endStreamingLocally = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    applyEvent({ type: "end", reason: "idle" });
    setIsStreaming(false);
  }, [applyEvent]);

  // ---------------------------------------------------------------------------
  // Sync verbs
  // ---------------------------------------------------------------------------
  const initializeDraft = useCallback(() => {
    sessionRef.current!.state = createInitialSession();
    updateRevision();
    setHasLoadedSessionState(true);
  }, [updateRevision]);

  const syncSnapshot = useCallback(
    (snapshot: SessionSnapshot) => {
      const state = createInitialSession({
        messages: snapshot.messages,
        queuedMessages: snapshot.queuedMessages ?? [],
        todos: snapshot.todos,
        linkedSessionIds: snapshot.linkedSessionIds,
        canvases: snapshot.canvases,
        artifacts: snapshot.artifacts,
        status: snapshot.status ?? "idle",
        reasoningContent: snapshot.reasoningContent ?? "",
        // Keep the locally seeded/picked configuration when the snapshot has
        // none (e.g. history replay that predates model events).
        modelConfiguration:
          snapshot.modelConfiguration ?? sessionRef.current!.state.modelConfiguration,
      });
      state.lastSeenEventId = snapshot.lastSeenEventId;
      sessionRef.current!.state = state;
      updateRevision();
      setHasLoadedSessionState(true);
    },
    [updateRevision],
  );

  /** Explicit user pick of the session's model configuration. Takes effect
   *  immediately in the UI and is sent with the next message. */
  const setModelConfiguration = useCallback(
    (configuration: ModelConfiguration) => {
      sessionRef.current!.state.modelConfiguration = configuration;
      updateRevision();
    },
    [updateRevision],
  );

  // ---------------------------------------------------------------------------
  // Stream attachment
  // ---------------------------------------------------------------------------
  const attachToStream = useCallback(async () => {
    if (abortControllerRef.current) return;

    try {
      const outcome = await runStreamingLoop({
        sessionId,
        afterEventId: sessionRef.current!.state.lastSeenEventId,
      });
      // Always reconcile against the authoritative snapshot when a passive
      // subscribe completes so the cache reflects the latest server state.
      if (outcome !== "aborted") {
        await invalidateSessionSnapshot();
      }
    } catch (error) {
      console.error("Subscription error:", error);
      await invalidateSessionSnapshot();
    }
  }, [invalidateSessionSnapshot, runStreamingLoop, sessionId]);

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------
  /** Optimistically show a follow-up prompt and deliver it to the server;
   *  rolls the local queue back if the server rejects it. */
  const sendFollowUp = useCallback(
    (prompt: string, attachments?: Attachment[], modelConfiguration?: ModelConfiguration) => {
      const clientMessageId = generateUUID();
      sessionRef.current!.state.queuedMessages.push({
        id: clientMessageId,
        role: "user",
        content: prompt,
        attachments,
        modelConfiguration,
      });
      updateRevision();

      deliverMessage({
        data: {
          sessionId,
          content: prompt,
          clientMessageId,
          attachments,
          modelConfiguration,
        },
      })
        .then((receipt) => {
          if (receipt.disposition === "sent") {
            void attachToStream();
          }
        })
        .catch(async (error) => {
          console.error("Failed to deliver follow-up message:", error);
          const queue = sessionRef.current!.state.queuedMessages;
          const index = queue.findIndex((m) => m.id === clientMessageId);
          if (index !== -1) {
            queue.splice(index, 1);
            updateRevision();
          }
          await invalidateSessionSnapshot();
        });
    },
    [attachToStream, invalidateSessionSnapshot, sessionId, updateRevision],
  );

  const sendMessage = useCallback(
    async (prompt: string, imageAttachments: Attachment[] = [], options?: SendMessageOptions) => {
      if (!prompt.trim() && imageAttachments.length === 0) return;
      const clientMessageId = generateUUID();
      const attachments = imageAttachments.length > 0 ? imageAttachments : undefined;
      const isFirstDraftMessage = !persistedSessionRef.current!.exists;

      // The session's own configuration always wins; the first draft message
      // falls back to the global default.
      const modelConfiguration =
        sessionRef.current!.state.modelConfiguration ??
        (isFirstDraftMessage ? defaultModelConfiguration : undefined);

      // Enqueue if a stream is already active. We gate on the controller ref
      // (not only React state) so rapid consecutive sends in the same tick
      // reliably enqueue instead of racing into a second stream.
      if (abortControllerRef.current || isStreaming) {
        sendFollowUp(prompt, attachments, modelConfiguration);
        return;
      }

      // Start a new streaming response. Seed the session's model configuration
      // with what we're about to send — this mirrors the server, which seeds its
      // stream state the same way and therefore never re-announces the initial
      // model via a model_changed event. Without this, a draft's picker would
      // blank out when the draft becomes a persisted session mid-stream.
      if (modelConfiguration) {
        sessionRef.current!.state.modelConfiguration = modelConfiguration;
      }
      applyWorkspaceEvent({ type: "session.running", sessionId });
      applyEvent({
        type: "user_message",
        content: prompt,
        attachments,
        clientMessageId,
        timestamp: new Date().toISOString(),
      });
      applyEvent({ type: "status", status: "thinking" });

      // Mark the draft as a real session once the server confirms creation.
      // This fires from both paths because a stream can complete without
      // emitting any events.
      let hasMarkedDraftCreated = false;
      const markDraftCreated = () => {
        if (!isFirstDraftMessage || hasMarkedDraftCreated) return;
        hasMarkedDraftCreated = true;
        applyWorkspaceEvent({
          type: "session.upserted",
          session: draftToSessionUpdate(sessionId, draftSession),
        });
      };

      try {
        await runStreamingLoop(
          {
            sessionId,
            prompt,
            attachments,
            clientMessageId,
            startNew: isFirstDraftMessage,
            modelConfiguration,
            directory: isFirstDraftMessage ? (options?.directory ?? sessionDirectory) : undefined,
            useWorktree: isFirstDraftMessage ? sessionUseWorktree : undefined,
          },
          {
            // Fired once the stream request is established. Mark the persisted
            // session as present so a rapid follow-up send enqueues instead
            // of racing into a second startNew; the list handoff waits for the
            // first server event (markDraftCreated).
            onStarted: () => {
              if (isFirstDraftMessage) {
                persistedSessionRef.current!.exists = true;
              }
            },
            onFirstEvent: () => {
              markDraftCreated();
            },
            // Stream completed: notify creation (covers event-less streams)
            // and reconcile with the server's authoritative snapshot.
            onSuccess: () => {
              markDraftCreated();
              void invalidateSessionSnapshot();
            },
          },
        );
      } catch (error) {
        console.error("Streaming error:", error);
        applyEvent({ type: "end", reason: "error" });
        // Roll back the optimistic running this send set above (unchanged from
        // before this fix): a failed send generally means no turn opened.
        applyWorkspaceEvent({ type: "session.idle", sessionId });
        void invalidateSessionSnapshot();
      }
    },
    [
      applyEvent,
      invalidateSessionSnapshot,
      isStreaming,
      runStreamingLoop,
      applyWorkspaceEvent,
      draftSession,
      sessionDirectory,
      defaultModelConfiguration,
      sendFollowUp,
      sessionUseWorktree,
      sessionId,
    ],
  );

  const cancelQueuedMessage = useCallback(
    async (queuedMessageId: string) => {
      const queue = sessionRef.current!.state.queuedMessages;
      const index = queue.findIndex((m) => m.id === queuedMessageId);
      if (index === -1) return;
      const [removedMessage] = queue.splice(index, 1);
      updateRevision();

      try {
        const serverRemoved = await serverCancelQueuedMessage({
          data: { sessionId, queuedMessageId },
        });
        if (!serverRemoved) {
          await invalidateSessionSnapshot();
        }
      } catch {
        // Roll the optimistic removal back at (or near) its original position.
        const safeIndex = Math.max(
          0,
          Math.min(index, sessionRef.current!.state.queuedMessages.length),
        );
        sessionRef.current!.state.queuedMessages.splice(safeIndex, 0, removedMessage);
        updateRevision();
        await invalidateSessionSnapshot();
      }
    },
    [invalidateSessionSnapshot, updateRevision, sessionId],
  );

  // ---------------------------------------------------------------------------
  // Stream control
  // ---------------------------------------------------------------------------
  /** Detach from the stream without canceling server-side processing.
   *  Used when backgrounding the app - server continues buffering for reconnect.
   *  Also clears local-change protection so we accept fresh state on return. */
  const detachFromStream = useCallback(() => {
    endStreamingLocally();
  }, [endStreamingLocally]);

  /** Stop the stream and server-side processing.
   *  Used when user explicitly stops the response. */
  const stopStream = useCallback(async () => {
    if (!isStreaming && !abortControllerRef.current) return;
    endStreamingLocally();

    // Stop is user-driven, so optimistically clear the running projection: the
    // user asked for idle, and abortSession below makes the server broadcast
    // session.idle to confirm across clients.
    applyWorkspaceEvent({ type: "session.idle", sessionId });

    // Clear local queued messages immediately so the UI reflects the
    // abort without waiting for a server round-trip. The server-side
    // abortSession handler clears the authoritative queue as well.
    sessionRef.current!.state.queuedMessages.length = 0;
    updateRevision();

    try {
      await abortSession({ data: { sessionId } });
    } catch {
      // fall through to invalidate
    }
    invalidateSessionSnapshot();
  }, [
    applyWorkspaceEvent,
    endStreamingLocally,
    invalidateSessionSnapshot,
    isStreaming,
    sessionId,
    updateRevision,
  ]);

  return {
    // Session state (re-read from the mutable ref on every revision bump)
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    modelConfiguration,
    todos,
    linkedSessionIds,
    canvases,
    artifacts,
    revision,
    hasLoadedSessionState,

    // Sync and local user state
    initializeDraft,
    syncSnapshot,
    setModelConfiguration,

    // Messaging
    sendMessage,
    cancelQueuedMessage,

    // Stream control
    attachToStream,
    detachFromStream,
    stopStream,
  };
}
