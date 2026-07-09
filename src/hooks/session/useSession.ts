/**
 * Client facade for one session's live state.
 *
 * The hook owns one pane's session lifecycle: hydrate cold state, observe live
 * work while visible, reduce stream events, and expose user commands. Server
 * functions keep the domain register underneath: observe, deliver, abort, and
 * cancel queue entries.
 *
 * Session creation: a draft session (see useDrafts) stays a draft until its
 * first send, which asks the server to create the session, with
 * `create` carrying creation-time options like directory and worktree. Once
 * the server confirms creation, this hook hands the draft off to session-list
 * state.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import {
  streamSession,
  abortSession,
  deliverMessage,
  cancelQueuedMessage as serverCancelQueuedMessage,
} from "@/functions/sessions";
import type { Attachment, ModelConfiguration, SessionEvent, SessionSnapshot } from "@/types";
import {
  applySessionEvent,
  createInitialSession,
  toSessionSnapshot,
} from "@/lib/session/sessionReducer";
import { sessionQueries, skillQueries } from "@/lib/queries";
import { consumeSessionEvents } from "@/lib/session/streamCodec";
import type { SessionSubscriptionMode, StreamSessionRequest } from "@/lib/session/protocol";
import { useWorkspaceActions } from "@/hooks/workspace/WorkspaceActionsContext";
import { sessionStatusAtom } from "@/hooks/workspace/atoms";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import { generateUUID } from "@/lib/utils";

interface SessionConfig {
  mode?: SessionSubscriptionMode;
  /** Browser default, used when no model has been projected for the session.
   *  Once the session has its own model, that always wins over this default. */
  defaultModel?: ModelConfiguration;
  /** Working directory for the session. Only sent with a draft's first message
   *  (the server fixes it at creation). */
  directory?: string;
  /** Run the session in an isolated git worktree. Creation-time only, like
   *  `directory`. */
  useWorktree?: boolean;
}

export function useSession(sessionId: string, sessionConfig?: SessionConfig) {
  const queryClient = useQueryClient();
  const { applyWorkspaceEvent, dispatchWorkspaceAction } = useWorkspaceActions();
  const workspaceSessionStatus = useAtomValue(sessionStatusAtom(sessionId));
  const sessionQuery = sessionQueries.detail(sessionId);
  const subscriptionMode = sessionConfig?.mode ?? "active";
  const defaultModel = sessionConfig?.defaultModel;
  const sessionDirectory = sessionConfig?.directory;
  const sessionUseWorktree = sessionConfig?.useWorktree;
  const isDraft = workspaceSessionStatus === "draft" || workspaceSessionStatus === "creating";
  const isSessionRunning = workspaceSessionStatus === "running";
  const isSessionUnread = workspaceSessionStatus === "unread";
  const isVisible = usePageVisibility();

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------
  // Events reduce into immutable states in this ref. The latest state is
  // published to React immediately for discrete events or once per frame for
  // rapid text deltas.
  const [publishedSession, setPublishedSession] = useState(createInitialSession);
  const sessionRef = useRef(publishedSession);
  // Closes the draft-to-session handoff window after the first server event.
  const draftPromotedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const wasVisibleRef = useRef(isVisible);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasLoadedSessionState, setHasLoadedSessionState] = useState(isDraft);
  const { data: sessionSnapshot, error } = useQuery({
    ...sessionQuery,
    enabled: !isDraft && !isStreaming,
  });

  /** Flush any pending batched update and publish the latest reduced state. */
  const publishState = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setPublishedSession(sessionRef.current);
  };

  /** Publish rapid updates together on the next animation frame. */
  const scheduleStatePublish = () => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      publishState();
    });
  };

  const {
    messages,
    queuedMessages,
    todos,
    linkedSessionIds,
    canvases,
    artifacts,
    status: baseStatus,
    reasoningContent,
    model,
  } = publishedSession;

  // During connection handshake we still want a spinner even if no events arrived yet.
  const status = isStreaming && baseStatus === "idle" ? "thinking" : baseStatus;

  // ---------------------------------------------------------------------------
  // Event application
  // ---------------------------------------------------------------------------
  const applyEvent = (event: SessionEvent) => {
    // Skills are directory-scoped — prime the React Query cache so all
    // sessions in the same CWD share the data without an extra RPC call.
    if (event.type === "skills") {
      if (sessionDirectory) {
        queryClient.setQueryData(skillQueries.byCwd(sessionDirectory), event.skills);
      }
      // Keep the stream cursor current without publishing a render; skills
      // live in their directory-scoped query cache, not Session state.
      sessionRef.current = applySessionEvent(sessionRef.current, event);
      return;
    }

    sessionRef.current = applySessionEvent(sessionRef.current, event);

    if (event.type === "delta" || event.type === "reasoning") {
      scheduleStatePublish();
    } else {
      publishState();
    }
  };

  /** Explicit user pick of the session's model. Takes effect
   *  immediately in the UI and is sent with the next message. */
  const setModel = (model: ModelConfiguration) => {
    sessionRef.current = { ...sessionRef.current, model };
    publishState();
  };

  // ---------------------------------------------------------------------------
  // Stream lifecycle
  // ---------------------------------------------------------------------------
  const invalidateSessionSnapshot = () =>
    queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });

  const streamEvents = async (request: StreamSessionRequest, onFirstEvent?: () => void) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    const consume = async () => {
      // Abort the request itself: cancelling only the decoded RawStream leaves
      // TanStack's multiplexed response subscribed on the server.
      const response = await streamSession({
        data: request,
        signal: controller.signal,
      });
      const receivedEvent = await consumeSessionEvents(
        response as unknown as ReadableStream<Uint8Array>,
        {
          signal: controller.signal,
          onEvent: applyEvent,
          onFirstEvent,
        },
      );

      if (controller.signal.aborted) return;

      // Real runtime streams publish `end` from the server. This fallback is
      // only for event-less observation when no live stream exists.
      if (!receivedEvent) {
        applyEvent({ type: "end", reason: "idle" });
      }

      // Keep the snapshot aligned with live state so reenabling its query
      // cannot briefly replay stale linked-session state.
      queryClient.setQueryData<SessionSnapshot>(sessionQuery.queryKey, (old) =>
        toSessionSnapshot(sessionId, sessionRef.current, old),
      );

      // Do not change workspace session status here. The runtime publishes
      // the terminal idle/unread transition when the stream truly closes. A
      // passive event-less subscription can also end without observing a turn.
    };

    try {
      await consume().finally(() => {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setIsStreaming(false);
        }
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }

    if (controller.signal.aborted) return;
    await invalidateSessionSnapshot();
  };

  const attachToStream = async (mode: SessionSubscriptionMode = "active") => {
    if (abortControllerRef.current) return;

    try {
      await streamEvents({
        sessionId,
        afterEventId: sessionRef.current.lastSeenEventId,
        mode,
      });
    } catch (error) {
      console.error("Subscription error:", error);
      await invalidateSessionSnapshot();
    }
  };

  // Detaching only ends this client's observation. The transient-state reset
  // goes through the reducer so local and server terminal cleanup cannot drift.
  // It deliberately leaves workspace status running because background work
  // continues on the server.
  const detachFromStream = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;

    controller.abort();
    abortControllerRef.current = null;
    applyEvent({ type: "end", reason: "idle" });
    setIsStreaming(false);
  };

  const stop = async () => {
    if (!abortControllerRef.current) return;
    detachFromStream();

    applyWorkspaceEvent({ type: "session.idle", sessionId });
    sessionRef.current = { ...sessionRef.current, queuedMessages: [] };
    publishState();

    try {
      await abortSession({ data: { sessionId } });
    } catch {
      // Reconcile below even when the abort request fails.
    }
    await invalidateSessionSnapshot();
  };

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------
  /** Optimistically show a follow-up prompt and deliver it to the server;
   *  rolls the local queue back if the server rejects it. */
  const sendFollowUp = async (
    prompt: string,
    attachments?: Attachment[],
    model?: ModelConfiguration,
  ) => {
    const clientMessageId = generateUUID();
    const state = sessionRef.current;
    sessionRef.current = {
      ...state,
      queuedMessages: [
        ...state.queuedMessages,
        {
          id: clientMessageId,
          role: "user",
          content: prompt,
          attachments,
          model,
        },
      ],
    };
    publishState();

    try {
      const receipt = await deliverMessage({
        data: {
          sessionId,
          message: {
            id: clientMessageId,
            content: prompt,
            attachments,
            model,
          },
        },
      });

      if (receipt.disposition === "started") {
        // The server replaced a stream that was still winding down locally.
        // Drop that stale subscription and follow the newly opened turn.
        detachFromStream();
        await attachToStream();
      }
    } catch (error) {
      console.error("Failed to deliver follow-up message:", error);
      const queue = sessionRef.current.queuedMessages;
      const index = queue.findIndex((message) => message.id === clientMessageId);
      if (index !== -1) {
        sessionRef.current = {
          ...sessionRef.current,
          queuedMessages: [...queue.slice(0, index), ...queue.slice(index + 1)],
        };
        publishState();
      }
      await invalidateSessionSnapshot();
    }
  };

  const sendMessage = async (prompt: string, attachments: Attachment[] = []) => {
    if (!prompt.trim() && attachments.length === 0) return;
    const clientMessageId = generateUUID();
    const messageAttachments = attachments.length > 0 ? attachments : undefined;
    const shouldCreateSession = workspaceSessionStatus === "draft" && !draftPromotedRef.current;

    // The session's own model always wins; otherwise this message makes the
    // browser selection the session's effective model.
    const model = sessionRef.current.model ?? defaultModel;

    // Enqueue if a stream is already active. We gate on the controller ref
    // (not only React state) so rapid consecutive sends in the same tick
    // reliably enqueue instead of racing into a second stream.
    if (abortControllerRef.current) {
      void sendFollowUp(prompt, messageAttachments, model);
      return;
    }

    // Start a new streaming response. Seed the session's model
    // with what we're about to send — this mirrors the server, which seeds its
    // stream state the same way and therefore never re-announces the initial
    // model via a model_changed event. Without this, a draft's picker would
    // blank out when the draft is promoted mid-stream.
    if (model) {
      sessionRef.current = { ...sessionRef.current, model };
    }
    applyWorkspaceEvent({
      type: shouldCreateSession ? "session.creating" : "session.running",
      sessionId,
    });
    applyEvent({
      type: "user_message",
      content: prompt,
      attachments: messageAttachments,
      clientMessageId,
      timestamp: new Date().toISOString(),
    });
    applyEvent({ type: "status", status: "thinking" });

    // A message-bearing stream always emits after subscribing; its first
    // server event is therefore the single proof that the session was created.
    const promoteDraft = () => {
      if (!shouldCreateSession || draftPromotedRef.current) return;
      draftPromotedRef.current = true;
      applyWorkspaceEvent({
        type: "session.upserted",
        session: { sessionId },
      });
    };

    const request: StreamSessionRequest = {
      sessionId,
      afterEventId: sessionRef.current.lastSeenEventId,
      message: {
        id: clientMessageId,
        content: prompt,
        attachments: messageAttachments,
        model,
      },
      create: shouldCreateSession
        ? {
            directory: sessionDirectory,
            useWorktree: sessionUseWorktree,
          }
        : undefined,
    };

    try {
      await streamEvents(request, promoteDraft);
    } catch (error) {
      console.error("Streaming error:", error);
      applyEvent({ type: "end", reason: "error" });
      // A creation failure restores the draft; a normal send failure becomes idle.
      applyWorkspaceEvent({ type: "session.idle", sessionId });
      await invalidateSessionSnapshot();
    }
  };

  const cancelQueuedMessage = async (queuedMessageId: string) => {
    const queue = sessionRef.current.queuedMessages;
    const index = queue.findIndex((message) => message.id === queuedMessageId);
    if (index === -1) return;
    const removedMessage = queue[index];
    sessionRef.current = {
      ...sessionRef.current,
      queuedMessages: [...queue.slice(0, index), ...queue.slice(index + 1)],
    };
    publishState();

    try {
      const serverRemoved = await serverCancelQueuedMessage({
        data: { sessionId, queuedMessageId },
      });
      if (!serverRemoved) {
        await invalidateSessionSnapshot();
      }
    } catch {
      // Roll the optimistic removal back at (or near) its original position.
      const safeIndex = Math.max(0, Math.min(index, sessionRef.current.queuedMessages.length));
      const currentQueue = sessionRef.current.queuedMessages;
      sessionRef.current = {
        ...sessionRef.current,
        queuedMessages: [
          ...currentQueue.slice(0, safeIndex),
          removedMessage,
          ...currentQueue.slice(safeIndex),
        ],
      };
      publishState();
      await invalidateSessionSnapshot();
    }
  };

  // ---------------------------------------------------------------------------
  // Pane lifecycle
  // ---------------------------------------------------------------------------
  useEffect(
    () => () => {
      const controller = abortControllerRef.current;
      controller?.abort();
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    },
    [],
  );

  // Drafts have no persisted snapshot. Live state wins while connected; an
  // idle session adopts the latest authoritative snapshot.
  useEffect(() => {
    if (isDraft) return;

    if (!isStreaming && sessionSnapshot) {
      const restoredSession = {
        ...createInitialSession({
          messages: sessionSnapshot.messages,
          queuedMessages: sessionSnapshot.queuedMessages ?? [],
          todos: sessionSnapshot.todos,
          linkedSessionIds: sessionSnapshot.linkedSessionIds,
          canvases: sessionSnapshot.canvases,
          artifacts: sessionSnapshot.artifacts,
          status: sessionSnapshot.status ?? "idle",
          reasoningContent: sessionSnapshot.reasoningContent ?? "",
          // Keep the locally picked model when older history has none.
          model: sessionSnapshot.model ?? sessionRef.current.model,
        }),
        lastSeenEventId: sessionSnapshot.lastSeenEventId,
      };
      sessionRef.current = restoredSession;
      setPublishedSession(restoredSession);
      setHasLoadedSessionState(true);
    }
  }, [isDraft, isStreaming, sessionSnapshot]);

  // Reconcile the subscriber whenever its visibility or the session's
  // workspace state changes. Effect events keep transport implementation
  // details out of the reactive transition inputs.
  const reconcileObservation = useEffectEvent(() => {
    if (wasVisibleRef.current !== isVisible) {
      wasVisibleRef.current = isVisible;
      if (!isVisible) {
        detachFromStream();
        return;
      }
      void invalidateSessionSnapshot();
    }

    if (isDraft || !isVisible || !hasLoadedSessionState) return;

    if (isSessionRunning) {
      void attachToStream(subscriptionMode);
      return;
    }

    if (subscriptionMode === "passive" || !isSessionUnread) return;

    void invalidateSessionSnapshot();
    dispatchWorkspaceAction({ type: "session.read", sessionId });
  });

  // Every visible pane observes live work. A passive subscriber never
  // acknowledges completion or clears an existing unread state.
  useEffect(() => {
    reconcileObservation();
  }, [
    hasLoadedSessionState,
    isDraft,
    isSessionRunning,
    isSessionUnread,
    isVisible,
    sessionId,
    subscriptionMode,
  ]);

  return {
    // Session state
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    model,
    todos,
    linkedSessionIds,
    canvases,
    artifacts,
    hasLoadedSessionState,
    error,

    // User commands
    setModel,
    stop,
    sendMessage,
    cancelQueuedMessage,
  };
}
