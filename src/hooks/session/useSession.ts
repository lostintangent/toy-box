/**
 * Manages a single session's live runtime: mutable state with batched
 * rendering, SSE streaming, message sending/queuing, and query cache
 * synchronization.
 *
 * Session creation: a draft session (see useDraftSession) exists only on the
 * client until its first send, which asks the server to create the session
 * (`startNew`, plus creation-time options like directory and worktree). Once
 * the server confirms the session exists, `sessionConfig.onSessionCreated`
 * fires exactly once — the parent wires this to the draft's promotion. This
 * hook never learns what promotion means; it only reports the moment.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectSessionStream,
  abortSession,
  enqueueMessage,
  cancelQueuedMessage as serverCancelQueuedMessage,
} from "@/functions/sessions";
import type {
  Attachment,
  Message,
  QueuedMessage,
  ModelConfiguration,
  SessionEvent,
  SessionSnapshot,
  SessionStatus,
  TodoItem,
} from "@/types";
import {
  applySessionEvent,
  applyStreamError,
  createInitialSession,
  toSessionSnapshot,
  type Session,
} from "@/lib/session/sessionReducer";
import { sessionQueries, skillQueries } from "@/lib/queries";
import { setSessionStreaming } from "@/lib/session/sessionsCache";
import { decodeSessionEvents } from "@/lib/session/streamCodec";
import { generateUUID } from "@/lib/utils";

const THINKING_STATUS: SessionStatus = "thinking";
const STREAM_ERROR_MESSAGE = "An error occurred. Please try again.";

/** Returns true for high-frequency events that should be batched per-frame. */
export function isBatchableEvent(event: SessionEvent): boolean {
  return event.type === "delta" || event.type === "reasoning";
}

type StreamLoopOutcome = "completed" | "aborted" | "failed";

type SendMessageOptions = {
  directory?: string;
};

export interface SessionConfig {
  /** True while the session exists only on the client (no first prompt sent yet). */
  isDraft?: boolean;
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
  /** Fired exactly once, when the server confirms a draft's session exists
   *  (first stream event, or completion of an event-less first turn). Wire
   *  this to the draft's promotion (useDraftSession.promoteDraft). */
  onSessionCreated?: () => void;
}

type SessionStateUpdate = {
  messages: Message[];
  queuedMessages?: QueuedMessage[];
  todos?: TodoItem[];
  linkedSessionIds?: string[];
  lastSeenEventId?: number;
  status?: SessionStatus;
  reasoningContent?: string;
  modelConfiguration?: ModelConfiguration;
};

export function useSession(sessionId: string, sessionConfig?: SessionConfig) {
  const queryClient = useQueryClient();
  const detailQueryKey = sessionQueries.detail(sessionId).queryKey;
  const defaultModelConfiguration = sessionConfig?.defaultModelConfiguration;
  const sessionDirectory = sessionConfig?.directory;
  const sessionUseWorktree = sessionConfig?.useWorktree;
  const onSessionCreated = sessionConfig?.onSessionCreated;

  // ---------------------------------------------------------------------------
  // Query cache helpers
  // ---------------------------------------------------------------------------
  const setCachedSessionSnapshot = useCallback(
    (state: Session) => {
      // Keep the detail query in sync with the live stream so reenabling the
      // query after streaming does not briefly replay stale linked-session state.
      queryClient.setQueryData<SessionSnapshot>(detailQueryKey, (old) =>
        toSessionSnapshot(sessionId, state, old),
      );
    },
    [queryClient, detailQueryKey, sessionId],
  );

  const invalidateDetailQuery = useCallback(
    () => queryClient.invalidateQueries({ queryKey: detailQueryKey }),
    [queryClient, detailQueryKey],
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

  // Whether the session exists on the server. Seeded from the isDraft prop and
  // then latched on the first send (see sendMessage's onStarted): the parent
  // promotes the draft mid-stream, flipping the prop, and that must not
  // re-trigger a second `startNew`.
  const sessionStartedRef = useRef<{ sessionId: string; started: boolean } | null>(null);
  if (!sessionStartedRef.current || sessionStartedRef.current.sessionId !== sessionId) {
    sessionStartedRef.current = { sessionId, started: !sessionConfig?.isDraft };
  }

  // A revision counter that triggers React re-renders. Incrementing this is
  // how we tell React "the mutable state in sessionRef has changed, re-read it."
  // For high-frequency streaming deltas, the increment is deferred to the next
  // animation frame so multiple mutations coalesce into a single render.
  const [revision, setRevision] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
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
    status: baseStatus,
    reasoningContent,
    modelConfiguration,
  } = sessionRef.current.state;

  // During connection handshake we still want a spinner even if no events arrived yet.
  const status = isStreaming && baseStatus === "idle" ? THINKING_STATUS : baseStatus;

  useEffect(() => {
    setHasSynced(false);
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

      if (isBatchableEvent(event)) {
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
      streamData: Parameters<typeof connectSessionStream>[0]["data"],
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
        const raw = await connectSessionStream({
          data: streamData,
          signal: controller.signal,
        });
        const stream = raw as unknown as ReadableStream<Uint8Array>;
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
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          outcome = "aborted";
        } else {
          throw error;
        }
      } finally {
        if (outcome !== "aborted") {
          applyEvent({ type: "stream_end", reason: "idle" });
        }
        if (outcome === "completed") {
          setCachedSessionSnapshot(sessionRef.current!.state);
          setSessionStreaming(queryClient, sessionId, false);
        }
        setIsStreaming(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }

      return outcome;
    },
    [applyEvent, queryClient, sessionId, setCachedSessionSnapshot],
  );

  // End streaming locally (used when detaching or force-stopping). The
  // transient-state reset is the reducer's stream_end policy — applied
  // directly so it can never drift from the server's stream end semantics.
  const endStreamingLocally = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    applySessionEvent(sessionRef.current!.state, { type: "stream_end", reason: "idle" });
    updateRevision();
    setIsStreaming(false);
  }, [updateRevision]);

  /** Optimistically queue a follow-up prompt behind the active stream and
   *  mirror it to the server; rolls the local queue back if the server
   *  rejects it. */
  const enqueueFollowUp = useCallback(
    (prompt: string, attachments?: Attachment[], modelConfiguration?: ModelConfiguration) => {
      const queuedMessageId = generateUUID();
      sessionRef.current!.state.queuedMessages.push({
        id: queuedMessageId,
        role: "user",
        content: prompt,
        attachments,
        modelConfiguration,
      });
      updateRevision();

      enqueueMessage({
        data: {
          sessionId,
          content: prompt,
          queuedMessageId,
          attachments,
          modelConfiguration,
        },
      }).catch(async (error) => {
        console.error("Failed to enqueue message:", error);
        const queue = sessionRef.current!.state.queuedMessages;
        const index = queue.findIndex((m) => m.id === queuedMessageId);
        if (index !== -1) {
          queue.splice(index, 1);
          updateRevision();
        }
        await invalidateDetailQuery();
      });
    },
    [invalidateDetailQuery, sessionId, updateRevision],
  );

  const sendMessage = useCallback(
    async (prompt: string, imageAttachments: Attachment[] = [], options?: SendMessageOptions) => {
      if (!prompt.trim() && imageAttachments.length === 0) return;
      const clientMessageId = generateUUID();
      const attachments = imageAttachments.length > 0 ? imageAttachments : undefined;
      const isFirstMessageToDraft = !sessionStartedRef.current!.started;

      // The session's own configuration always wins; an unstarted session's
      // first message falls back to the global default.
      const modelConfiguration =
        sessionRef.current!.state.modelConfiguration ??
        (isFirstMessageToDraft ? defaultModelConfiguration : undefined);

      // Enqueue if a stream is already active. We gate on the controller ref
      // (not only React state) so rapid consecutive sends in the same tick
      // reliably enqueue instead of racing into a second stream.
      if (abortControllerRef.current || isStreaming) {
        enqueueFollowUp(prompt, attachments, modelConfiguration);
        return;
      }

      // Start a new streaming response. Seed the session's model configuration
      // with what we're about to send — this mirrors the server, which seeds its
      // stream state the same way and therefore never re-announces the initial
      // model via a model_changed event. Without this, a draft's picker would
      // blank out when the draft becomes a real session mid-stream.
      if (modelConfiguration) {
        sessionRef.current!.state.modelConfiguration = modelConfiguration;
      }
      setSessionStreaming(queryClient, sessionId, true);
      applyEvent({
        type: "user_message",
        content: prompt,
        attachments,
        clientMessageId,
        timestamp: new Date().toISOString(),
      });
      applyEvent({ type: "thinking" });

      // Promote the draft once the server confirms the session exists. Fired
      // from both onFirstEvent and onSuccess (idempotent) because a stream
      // can complete without emitting any events.
      let hasNotifiedDraftCreated = false;
      const notifyDraftCreated = () => {
        if (!isFirstMessageToDraft || hasNotifiedDraftCreated) return;
        hasNotifiedDraftCreated = true;
        onSessionCreated?.();
      };

      try {
        await runStreamingLoop(
          {
            sessionId,
            prompt,
            attachments,
            clientMessageId,
            startNew: isFirstMessageToDraft,
            modelConfiguration,
            directory: isFirstMessageToDraft ? (options?.directory ?? sessionDirectory) : undefined,
            useWorktree: isFirstMessageToDraft ? sessionUseWorktree : undefined,
          },
          {
            // Fired once the stream request is established. Mark the draft as
            // started immediately so a rapid follow-up send enqueues instead
            // of racing into a second startNew; the list handoff waits for the
            // first server event (notifyDraftCreated).
            onStarted: () => {
              if (isFirstMessageToDraft) {
                sessionStartedRef.current!.started = true;
              }
            },
            onFirstEvent: () => {
              notifyDraftCreated();
            },
            // Stream completed: promote (covers event-less streams) and
            // reconcile with the server's authoritative detail state.
            onSuccess: () => {
              notifyDraftCreated();
              void invalidateDetailQuery();
            },
          },
        );
      } catch (error) {
        console.error("Streaming error:", error);
        applyStreamError(sessionRef.current!.state, STREAM_ERROR_MESSAGE);
        updateRevision();
        setSessionStreaming(queryClient, sessionId, false);
        void invalidateDetailQuery();
      }
    },
    [
      applyEvent,
      enqueueFollowUp,
      invalidateDetailQuery,
      queryClient,
      updateRevision,
      isStreaming,
      runStreamingLoop,
      onSessionCreated,
      sessionDirectory,
      defaultModelConfiguration,
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
          await invalidateDetailQuery();
        }
      } catch {
        // Roll the optimistic removal back at (or near) its original position.
        const safeIndex = Math.max(
          0,
          Math.min(index, sessionRef.current!.state.queuedMessages.length),
        );
        sessionRef.current!.state.queuedMessages.splice(safeIndex, 0, removedMessage);
        updateRevision();
        await invalidateDetailQuery();
      }
    },
    [invalidateDetailQuery, updateRevision, sessionId],
  );

  const updateState = useCallback(
    (snapshot: SessionStateUpdate) => {
      const state = createInitialSession({
        messages: snapshot.messages,
        queuedMessages: snapshot.queuedMessages ?? [],
        todos: snapshot.todos,
        linkedSessionIds: snapshot.linkedSessionIds,
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
      setHasSynced(true);
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

  const attachToStream = useCallback(async () => {
    if (abortControllerRef.current) return; // Already streaming

    try {
      const outcome = await runStreamingLoop({
        sessionId,
        afterEventId: sessionRef.current!.state.lastSeenEventId,
      });
      // Always reconcile against authoritative detail state when a passive
      // subscribe completes so the cached detail reflects the latest server state.
      if (outcome !== "aborted") {
        await invalidateDetailQuery();
      }
    } catch (error) {
      console.error("Subscription error:", error);
      await invalidateDetailQuery();
    }
  }, [invalidateDetailQuery, runStreamingLoop, sessionId]);

  /** Detach from the stream without canceling server-side processing.
   *  Used when backgrounding the app - server continues buffering for reconnect.
   *  Also clears local-change protection so we accept fresh state on return. */
  const detachFromStream = useCallback(() => {
    endStreamingLocally();
  }, [endStreamingLocally]);

  /** Cancel the stream and server-side processing.
   *  Used when user explicitly stops the response. */
  const cancelStream = useCallback(async () => {
    if (!isStreaming && !abortControllerRef.current) return;
    setSessionStreaming(queryClient, sessionId, false);
    endStreamingLocally();

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
    invalidateDetailQuery();
  }, [
    endStreamingLocally,
    invalidateDetailQuery,
    isStreaming,
    queryClient,
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
    revision,
    hasSynced,

    // State mutation (snapshot sync + explicit user picks)
    updateState,
    setModelConfiguration,

    // Messaging
    sendMessage,
    cancelQueuedMessage,

    // Stream control
    attachToStream,
    detachFromStream,
    cancelStream,
  };
}
