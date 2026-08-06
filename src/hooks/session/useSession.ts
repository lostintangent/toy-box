/**
 * Client facade for one session's live state.
 *
 * The hook owns one pane's session lifecycle: hydrate cold state, stream live
 * work while visible, reduce stream events, and expose user commands. Server
 * functions keep the domain register underneath: stream, deliver, steer or
 * cancel queued input, and abort.
 *
 * Draft start: a draft (see useDrafts) already owns a durable SDK
 * workspace, but its first send creates the turn-bearing SDK history with
 * `location` carrying its directory and worktree choice. Once
 * delivery begins, the ordinary runtime `running` transition replaces its
 * draft status.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  streamSession,
  abortSession,
  deliverMessage,
  cancelQueuedMessage as serverCancelQueuedMessage,
  steerQueuedMessage as serverSteerQueuedMessage,
} from "@/functions/sessions";
import type { Attachment, ModelConfiguration, SessionEvent, SessionSnapshot } from "@/types";
import {
  applySessionEvent,
  createInitialSession,
  toSessionSnapshot,
} from "@/lib/session/sessionReducer";
import { sessionQueries } from "@/lib/queries";
import type { SessionSubscriptionMode, StreamSessionRequest } from "@/lib/session/protocol";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import { generateUUID } from "@/lib/utils";
import { applyWorkspaceEvent, dispatchWorkspaceAction } from "@/lib/workspace/state/query";
import type { WorkspaceSessionState } from "@/lib/workspace/state/reducer";

interface SessionConfig {
  workspaceSessionStatus: WorkspaceSessionState["status"];
  mode?: SessionSubscriptionMode;
  /** Browser default, used when no model has been projected for the session.
   *  Once the session has its own model, that always wins over this default. */
  defaultModel?: ModelConfiguration;
  /** Working directory for the session. Only sent as a draft's initial location. */
  directory?: string;
  /** Run the session in an isolated git worktree. Initial-location only. */
  useWorktree?: boolean;
  /** Optional artifact already owned by this draft. */
  draftArtifactPath?: string;
}

export function useSession(
  sessionId: string,
  {
    workspaceSessionStatus,
    mode: subscriptionMode = "active",
    defaultModel,
    directory: sessionDirectory,
    useWorktree: sessionUseWorktree,
    draftArtifactPath,
  }: SessionConfig,
) {
  const queryClient = useQueryClient();
  const sessionQuery = sessionQueries.detail(sessionId);
  const isDraft = workspaceSessionStatus === "draft";
  const isSessionRunning = workspaceSessionStatus === "running";
  const isSessionUnread = workspaceSessionStatus === "unread";
  const isVisible = usePageVisibility();

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------
  // Events reduce into immutable states in this ref. The latest state is
  // published to React immediately for discrete events or once per frame for
  // rapid text deltas.
  const [publishedSession, setPublishedSession] = useState(() =>
    createInitialSession(draftArtifactPath ? { artifacts: [draftArtifactPath] } : {}),
  );
  const sessionRef = useRef(publishedSession);
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
    openedFiles,
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

  const streamEvents = async (request: StreamSessionRequest) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    const consume = async () => {
      const events = await streamSession({
        data: request,
        signal: controller.signal,
      });
      let receivedEvent = false;
      if (events) {
        const iterator = events[Symbol.asyncIterator]();
        while (!controller.signal.aborted) {
          const next = await iterator.next();
          if (next.done) break;
          receivedEvent = true;
          applyEvent(next.value);
        }
      }

      if (controller.signal.aborted) return;

      // Real runtime streams publish `end` from the server. This fallback is
      // only for an event-less subscription when no live stream exists.
      if (!receivedEvent) {
        applyEvent({ type: "end", reason: "idle" });
      }

      // Keep the snapshot aligned with live state so reenabling its query
      // cannot briefly replay stale linked-session state.
      queryClient.setQueryData<SessionSnapshot>(sessionQuery.queryKey, (old) =>
        toSessionSnapshot(sessionId, sessionRef.current, old),
      );

      // Do not change workspace session status here. The runtime publishes
      // the terminal idle/unread transition when the execution truly finishes. A
      // passive event-less subscription can also end without receiving a turn.
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

  const subscribeToSession = async (mode: SessionSubscriptionMode = "active") => {
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

  // Ending the subscription resets only this client's transient state. The reset
  // goes through the reducer so local and server terminal cleanup cannot drift.
  // It deliberately leaves workspace status running because background work
  // continues on the server.
  const endSubscription = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;

    controller.abort();
    abortControllerRef.current = null;
    applyEvent({ type: "end", reason: "idle" });
    setIsStreaming(false);
  };

  const stop = async () => {
    if (!abortControllerRef.current) return;
    endSubscription();

    applyWorkspaceEvent(queryClient, { type: "session.idle", sessionId });
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
        endSubscription();
        await subscribeToSession();
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

    // The session's own model always wins; otherwise this message makes the
    // browser selection the session's effective model.
    const model = sessionRef.current.model ?? defaultModel;

    // Server running state owns the send-vs-queue distinction. The controller
    // also closes the same-tick gap before that shared state reaches React.
    if (isSessionRunning || abortControllerRef.current) {
      void sendFollowUp(prompt, messageAttachments, model);
      return;
    }

    // Start a new streaming response. Seed the session's model
    // with what we're about to send — this mirrors the server, which seeds its
    // stream state the same way and therefore never re-announces the initial
    // model via a model_changed event. Without this, a draft's picker would
    // blank out when the draft starts running.
    if (model) {
      sessionRef.current = { ...sessionRef.current, model };
    }
    if (!isDraft) {
      applyWorkspaceEvent(queryClient, { type: "session.running", sessionId });
    }
    applyEvent({
      type: "user_message",
      content: prompt,
      attachments: messageAttachments,
      clientMessageId,
      timestamp: new Date().toISOString(),
    });
    applyEvent({ type: "status", status: "thinking" });

    const request: StreamSessionRequest = {
      sessionId,
      afterEventId: sessionRef.current.lastSeenEventId,
      message: {
        id: clientMessageId,
        content: prompt,
        attachments: messageAttachments,
        model,
      },
      location: isDraft
        ? {
            directory: sessionDirectory,
            useWorktree: sessionUseWorktree,
          }
        : undefined,
    };

    try {
      await streamEvents(request);
    } catch (error) {
      console.error("Streaming error:", error);
      applyEvent({ type: "end", reason: "error" });
      // Reconcile the optimistic running state; an unstarted draft ignores idle.
      applyWorkspaceEvent(queryClient, { type: "session.idle", sessionId });
      await invalidateSessionSnapshot();
    }
  };

  const runQueueMutation = async (request: () => Promise<boolean>) => {
    try {
      const changed = await request();
      if (!changed) await invalidateSessionSnapshot();
      return changed;
    } catch {
      await invalidateSessionSnapshot();
      return false;
    }
  };

  const cancelQueuedMessage = (queuedMessageId: string) =>
    runQueueMutation(() =>
      serverCancelQueuedMessage({
        data: { sessionId, queuedMessageId },
      }),
    );

  const steerQueuedMessage = (queuedMessageId: string) =>
    runQueueMutation(() =>
      serverSteerQueuedMessage({
        data: { sessionId, queuedMessageId },
      }),
    );

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

  // A draft workspace has no SDK-history snapshot until its first turn. Live state
  // wins while connected; an idle started session adopts the latest snapshot.
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
          openedFiles: sessionSnapshot.openedFiles,
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
  const reconcileSubscription = useEffectEvent(() => {
    if (wasVisibleRef.current !== isVisible) {
      wasVisibleRef.current = isVisible;
      if (!isVisible) {
        endSubscription();
        return;
      }
      void invalidateSessionSnapshot();
    }

    if (isDraft || !isVisible || !hasLoadedSessionState) return;

    if (isSessionRunning) {
      void subscribeToSession(subscriptionMode);
      return;
    }

    if (subscriptionMode === "passive" || !isSessionUnread) return;

    void invalidateSessionSnapshot();
    dispatchWorkspaceAction(queryClient, { type: "session.read", sessionId });
  });

  // Every visible pane streams live work. A passive subscriber never
  // acknowledges completion or clears an existing unread state.
  useEffect(() => {
    reconcileSubscription();
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
    openedFiles,
    hasLoadedSessionState,
    error,

    // User commands
    setModel,
    stop,
    sendMessage,
    cancelQueuedMessage,
    steerQueuedMessage,
  };
}
