/**
 * Client facade for one session's live state.
 *
 * The hook owns one pane's session lifecycle: hydrate cold state, stream live
 * work while visible, reduce stream events, and expose user commands. Mutations
 * carry request/response commands; the long-lived event stream stays explicit.
 *
 * First turn: a draft session owns a public ID and artifacts,
 * and its first send creates the selected provider's history with
 * `location` carrying its directory and worktree choice. Submission seeds its
 * catalog entry and applies the ordinary `running` transition optimistically;
 * provider creation then supplies the authoritative metadata.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelConfiguration } from "@providers/model";
import { applySessionEvent, createInitialSessionState } from "./model/reducer";
import type { Session, SessionEvent, SessionLaunch, SessionState, UserMessage } from "./model";
import type { SessionSubscriptionMode, StreamSessionRequest } from "./model/protocol";
import { sessionMutations } from "./mutations";
import { sessionQueries } from "./queries";
import {
  cancelSessionsStateQuery,
  invalidateSessionsStateQuery,
  upsertSessionInState,
} from "./queryCache";
import { streamSession } from "./server/functions";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { generateUUID } from "@/shared/utils";
import {
  applyWorkspaceEvent,
  dispatchWorkspaceAction,
  repairWorkspaceStateQuery,
} from "@workspace/queries";
import { isWorkspaceSessionLive, type WorkspaceSessionState } from "@workspace/model/state/reducer";

interface SessionConfig {
  workspaceSessionStatus: WorkspaceSessionState["status"];
  mode?: SessionSubscriptionMode;
  /** Whether the owning pane is currently presented by its workspace host. */
  isVisible?: boolean;
  /** Browser default, used when no model has been projected for the session.
   *  Once the session has its own model, that always wins over this default. */
  defaultModel?: ModelConfiguration;
  /** Working directory for the session. Only sent as the first turn's location. */
  directory?: string;
  /** Run the session in an isolated git worktree. Initial-location only. */
  useWorktree?: boolean;
  /** Catalog record; its provider determines whether history exists yet. */
  session?: Session;
}

export function useSession(
  sessionId: string,
  {
    workspaceSessionStatus,
    mode: subscriptionMode = "active",
    isVisible: paneIsVisible = true,
    defaultModel,
    directory: sessionDirectory,
    useWorktree: sessionUseWorktree,
    session,
  }: SessionConfig,
) {
  const queryClient = useQueryClient();
  const sessionQuery = sessionQueries.detail(sessionId);
  const isDraft = session !== undefined && !session.provider;
  const isSessionLive = isWorkspaceSessionLive(workspaceSessionStatus);
  const isSessionUnread = workspaceSessionStatus === "unread";
  const pageIsVisible = usePageVisibility();
  const isVisible = pageIsVisible && paneIsVisible;

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------
  // Events reduce into immutable states in this ref. The latest state is
  // published to React immediately for discrete events or once per frame for
  // rapid text deltas.
  const [publishedSession, setPublishedSession] = useState(() =>
    createInitialSessionState(session?.artifactPath ? { artifacts: [session.artifactPath] } : {}),
  );
  const sessionRef = useRef(publishedSession);
  const rafIdRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const wasVisibleRef = useRef(isVisible);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasLoadedSessionState, setHasLoadedSessionState] = useState(isDraft);
  const { data: sessionSnapshot, error } = useQuery({
    ...sessionQuery,
    enabled: isVisible && !isDraft && !isStreaming,
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

    if (event.type === "delta" || event.type === "reasoning_delta") {
      scheduleStatePublish();
    } else {
      publishState();
    }
  };

  /** The client-selected Session model. Takes effect immediately in the UI
   *  and is sent with the next message. */
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
      queryClient.setQueryData<SessionState>(sessionQuery.queryKey, sessionRef.current);

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

  // Ending observation never changes canonical session state; background work
  // continues on the server and a later subscription resumes from its cursor.
  const endSubscription = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;

    controller.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
  };

  const abortMutation = useMutation({
    ...sessionMutations.abortSession(sessionId),
    onMutate: () => {
      endSubscription();
      applyEvent({ type: "end", reason: "idle" });
      applyWorkspaceEvent(queryClient, { type: "session.idle", sessionId });
    },
  });

  const stop = () => {
    if (abortControllerRef.current) abortMutation.mutate();
  };

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------
  /** Optimistically show a follow-up prompt and deliver it to the server;
   *  rolls the local queue back if the server rejects it. */
  const followUpMutation = useMutation({
    ...sessionMutations.deliverMessage(sessionId),
    onMutate: (message) => {
      applyEvent({
        type: "message_queued",
        message: { ...message, role: "user" },
      });
    },
    onSuccess: (receipt) => {
      if (receipt.disposition === "started") {
        // The server replaced a stream that was still winding down locally.
        // Drop that stale subscription and follow the newly opened turn.
        endSubscription();
        void subscribeToSession();
      }
    },
    onError: (_error, message) => {
      applyEvent({ type: "message_cancelled", clientId: message.clientId });
    },
  });

  const sendMessage = async (
    input: Pick<UserMessage, "content" | "attachments">,
    { immediate }: { immediate?: true } = {},
  ) => {
    if (!input.content.trim() && !input.attachments?.length) return;
    const clientId = generateUUID();
    const now = new Date();

    // The session's own model always wins; otherwise this message makes the
    // browser selection the session's effective model.
    const model = sessionRef.current.model ?? defaultModel;
    const message = {
      ...input,
      clientId,
      attachments: input.attachments?.length ? input.attachments : undefined,
      model,
      immediate,
    } satisfies SessionLaunch["message"] & { clientId: string };

    if (isDraft) void cancelSessionsStateQuery(queryClient);
    upsertSessionInState(queryClient, {
      id: sessionId,
      updatedAt: now.toISOString(),
      ...(isDraft && {
        provider: model ? { id: model.provider } : undefined,
        context: { directory: sessionDirectory },
      }),
    });

    // Server running state owns the send-vs-queue distinction. The controller
    // also closes the same-tick gap before that shared state reaches React.
    if (isSessionLive || abortControllerRef.current) {
      followUpMutation.mutate(message);
      return;
    }

    // Start a new streaming response. Seed the session's model
    // with what we're about to send — this mirrors the server, which seeds its
    // stream state the same way and therefore never re-announces the initial
    // model via a model_changed event. This keeps the picker stable
    // while the first turn starts.
    if (model) {
      sessionRef.current = { ...sessionRef.current, model };
    }
    applyWorkspaceEvent(queryClient, { type: "session.running", sessionId });
    applyEvent({
      type: "user_message",
      content: message.content,
      attachments: message.attachments,
      clientId,
      timestamp: now.toISOString(),
    });

    const request: StreamSessionRequest = {
      sessionId,
      afterEventId: sessionRef.current.lastSeenEventId,
      message,
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
      if (isDraft) {
        // Creation may have failed before or after creating native history. Read
        // the authoritative lifecycle rather than guessing whether to undo it.
        await repairWorkspaceStateQuery(queryClient);
        await invalidateSessionsStateQuery(queryClient);
      } else {
        applyWorkspaceEvent(queryClient, { type: "session.idle", sessionId });
        await invalidateSessionSnapshot();
      }
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

  // Live state wins while connected. Otherwise adopt the cached snapshot, including
  // a replacement draft with its optimistic first message.
  useEffect(() => {
    if (!isStreaming && sessionSnapshot) {
      // Keep the locally picked model when older history has none.
      const restoredSession = {
        ...sessionSnapshot,
        model: sessionSnapshot.model ?? sessionRef.current.model,
      };
      sessionRef.current = restoredSession;
      setPublishedSession(restoredSession);
      setHasLoadedSessionState(true);
    }
  }, [isStreaming, sessionSnapshot]);

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

    if (isSessionLive) {
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
    isSessionLive,
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
  };
}
