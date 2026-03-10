/**
 * Manages a single session's lifecycle: mutable state with batched rendering,
 * SSE streaming, message sending/queuing, and query cache synchronization.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectSessionStream,
  abortSession,
  enqueueMessage,
  cancelQueuedMessage as serverCancelQueuedMessage,
} from "@/functions/sessions";
import type { Attachment, Message, QueuedMessage, SessionEvent, SessionStatus } from "@/types";
import {
  applySessionEvent,
  createInitialSession,
  type Session,
} from "@/lib/session/sessionReducer";
import { sessionQueries } from "@/lib/queries";
import { setSessionStreaming } from "@/lib/session/sessionsCache";
import { decodeSessionEvents } from "@/lib/session/streamCodec";
import { generateUUID } from "@/lib/utils";

const THINKING_STATUS: SessionStatus = "thinking";
const STREAM_ERROR_MESSAGE = "An error occurred. Please try again.";

function createStreamErrorState(state: Session): Session {
  const last = state.messages[state.messages.length - 1];
  const messages =
    last?.role === "assistant"
      ? [...state.messages.slice(0, -1), { ...last, content: STREAM_ERROR_MESSAGE }]
      : [...state.messages, { role: "assistant" as const, content: STREAM_ERROR_MESSAGE }];

  return {
    ...state,
    messages,
    status: "idle",
    reasoningContent: "",
    pendingToolCalls: new Map(),
  };
}

/** Returns true for high-frequency events that should be batched per-frame. */
function isBatchableEvent(event: SessionEvent): boolean {
  return event.type === "delta" || event.type === "reasoning";
}

type StreamLoopResult = {
  wasAborted: boolean;
  receivedData: boolean;
  outcome: "completed" | "aborted" | "failed";
};

type SendMessageOptions = {
  directory?: string;
};

export interface SessionConfig {
  model?: string;
  directory?: string;
  onSessionCreated?: () => void;
}

export function useSession(sessionId: string, sessionConfig?: SessionConfig) {
  const queryClient = useQueryClient();
  const detailQueryKey = sessionQueries.detail(sessionId).queryKey;

  // ---------------------------------------------------------------------------
  // Query cache helpers
  // ---------------------------------------------------------------------------
  const setCachedMessages = useCallback(
    (messages: Message[]) => {
      queryClient.setQueryData<Session>(detailQueryKey, (old) =>
        old ? { ...old, messages } : undefined,
      );
    },
    [queryClient, detailQueryKey],
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
  const sessionStartedRef = useRef<{ sessionId: string; started: boolean } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  if (!sessionStartedRef.current || sessionStartedRef.current.sessionId !== sessionId) {
    // A session is considered "started" (not a draft) when there is no
    // onSessionCreated callback. We can't gate on sessionConfig itself
    // because it now always carries the model for mid-session switches.
    sessionStartedRef.current = { sessionId, started: !sessionConfig?.onSessionCreated };
  }

  if (!sessionRef.current || sessionRef.current.sessionId !== sessionId) {
    sessionRef.current = {
      sessionId,
      state: createInitialSession({
        messages: [],
        queuedMessages: [],
        status: "idle",
        reasoningContent: "",
      }),
    };
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
    status: baseStatus,
    reasoningContent,
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
      applySessionEvent(sessionRef.current!.state, event);
      if (isBatchableEvent(event)) {
        scheduleRevision();
      } else {
        updateRevision();
      }
    },
    [scheduleRevision, updateRevision],
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
    ): Promise<StreamLoopResult> => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);

      let receivedData = false;
      let outcome: StreamLoopResult["outcome"] = "failed";

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
          setSessionStreaming(queryClient, sessionId, false);
        }
        setIsStreaming(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }

      return {
        wasAborted: outcome === "aborted",
        receivedData,
        outcome,
      };
    },
    [applyEvent, queryClient, sessionId],
  );

  // End streaming locally (used when detaching or force-stopping).
  const endStreamingLocally = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const state = sessionRef.current!.state;
    state.status = "idle";
    state.reasoningContent = "";
    state.pendingToolCalls.clear();
    state.pendingOptimisticUserMessage = undefined;
    updateRevision();
    setIsStreaming(false);
  }, [updateRevision]);

  const sendMessage = useCallback(
    async (prompt: string, imageAttachments: Attachment[] = [], options?: SendMessageOptions) => {
      if (!prompt.trim() && imageAttachments.length === 0) return;
      const clientMessageId = generateUUID();
      const attachments = imageAttachments.length > 0 ? imageAttachments : undefined;

      // Enqueue if a stream is already active. We gate on the controller ref
      // (not only React state) so rapid consecutive sends in the same tick
      // reliably enqueue instead of racing into a second stream.
      if (abortControllerRef.current || isStreaming) {
        const queuedMessageId = generateUUID();
        const queuedMessage: QueuedMessage = {
          id: queuedMessageId,
          role: "user",
          content: prompt,
          attachments,
        };

        sessionRef.current!.state.queuedMessages.push(queuedMessage);
        updateRevision();
        enqueueMessage({
          data: { sessionId, content: prompt, queuedMessageId, attachments },
        }).catch(async (error) => {
          console.error("Failed to enqueue message:", error);
          const queue = sessionRef.current!.state.queuedMessages;
          const idx = queue.findIndex((m) => m.id === queuedMessageId);
          if (idx !== -1) {
            queue.splice(idx, 1);
            updateRevision();
          }
          await invalidateDetailQuery();
        });
        return;
      }

      // Start a new streaming response.
      setSessionStreaming(queryClient, sessionId, true);
      applyEvent({
        type: "user_message",
        content: prompt,
        attachments,
        clientMessageId,
        timestamp: new Date().toISOString(),
      });
      applyEvent({ type: "thinking" });

      const isFirstMessageToDraft = !sessionStartedRef.current!.started;
      let hasNotifiedDraftCreated = false;
      const notifyDraftCreated = () => {
        if (!isFirstMessageToDraft || hasNotifiedDraftCreated) return;
        hasNotifiedDraftCreated = true;
        sessionConfig?.onSessionCreated?.();
      };

      try {
        await runStreamingLoop(
          {
            sessionId,
            prompt,
            attachments,
            clientMessageId,
            startNew: isFirstMessageToDraft,
            model: sessionConfig?.model,
            directory: isFirstMessageToDraft
              ? (options?.directory ?? sessionConfig?.directory)
              : undefined,
          },
          {
            // Fired once the stream request is established.
            onStarted: () => {
              if (isFirstMessageToDraft && !sessionStartedRef.current!.started) {
                // Mark local draft as started immediately to avoid duplicate callbacks,
                // but defer list handoff until we receive the first server event.
                sessionStartedRef.current!.started = true;
              }
            },
            onFirstEvent: () => {
              notifyDraftCreated();
            },
            // On success: finalize session state.
            onSuccess: () => {
              notifyDraftCreated();
              setCachedMessages(sessionRef.current!.state.messages);
              void invalidateDetailQuery();
            },
          },
        );
      } catch (error) {
        console.error("Streaming error:", error);
        sessionRef.current!.state = createStreamErrorState(sessionRef.current!.state);
        updateRevision();
        setSessionStreaming(queryClient, sessionId, false);
        void invalidateDetailQuery();
      }
    },
    [
      applyEvent,
      invalidateDetailQuery,
      queryClient,
      setCachedMessages,
      updateRevision,
      isStreaming,
      runStreamingLoop,
      sessionConfig,
      sessionId,
    ],
  );

  const cancelQueuedMessage = useCallback(
    async (queuedMessageId: string) => {
      const queue = sessionRef.current!.state.queuedMessages;
      const index = queue.findIndex((m) => m.id === queuedMessageId);
      if (index === -1) return;
      const [removed] = queue.splice(index, 1);
      updateRevision();

      try {
        const result = await serverCancelQueuedMessage({ data: { sessionId, queuedMessageId } });
        if (!result.success) {
          await invalidateDetailQuery();
        }
      } catch {
        const safeIndex = Math.max(
          0,
          Math.min(index, sessionRef.current!.state.queuedMessages.length),
        );
        sessionRef.current!.state.queuedMessages.splice(safeIndex, 0, removed);
        updateRevision();
        await invalidateDetailQuery();
      }
    },
    [invalidateDetailQuery, updateRevision, sessionId],
  );

  const updateState = useCallback(
    (
      serverMessages: Message[],
      serverQueuedMessages: QueuedMessage[],
      serverTodos?: Session["todos"],
      serverLastStreamingEventId?: number,
      serverStreamingStatus: SessionStatus = "idle",
      serverStreamingReasoningContent = "",
    ) => {
      const state = createInitialSession({
        messages: serverMessages,
        queuedMessages: serverQueuedMessages,
        todos: serverTodos,
        status: serverStreamingStatus,
        reasoningContent: serverStreamingReasoningContent,
      });
      state.lastSeenEventId = serverLastStreamingEventId;
      sessionRef.current!.state = state;
      updateRevision();
      setHasSynced(true);
    },
    [updateRevision],
  );

  const attachToStream = useCallback(async () => {
    if (abortControllerRef.current) return; // Already streaming

    // Prevent server sync from overwriting our streaming state

    try {
      const result = await runStreamingLoop({
        sessionId,
        afterEventId: sessionRef.current!.state.lastSeenEventId,
      });
      // Always reconcile against authoritative detail state when a passive
      // subscribe completes so the cached detail reflects the latest server state.
      if (!result.wasAborted) {
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
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    todos,
    revision,
    hasSynced,

    updateState,

    sendMessage,
    cancelQueuedMessage,

    attachToStream,
    detachFromStream,
    cancelStream,
  };
}
