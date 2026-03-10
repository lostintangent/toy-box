import {
  useEffect,
  useCallback,
  useMemo,
  useDeferredValue,
  memo,
  useRef,
  useLayoutEffect,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, Bot } from "lucide-react";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import type { Attachment, Message, ModelInfo } from "@/types";
import { sessionQueries } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Message as SessionMessage } from "./messages/Message";
import { StatusIndicator, ReasoningDisplay } from "./SessionStatus";
import type { SessionStatus } from "@/types";
import { SessionDirectoryPicker } from "./SessionDirectoryPicker";
import { SessionMetadataBadges } from "./SessionMetadataBadges";
import {
  findSessionDirectoryOption,
  normalizeSessionDirectoryOptions,
  type SessionDirectoryOption,
} from "./sessionDirectoryOptions";
import { SessionInput } from "./input/SessionInput";
import { useSession, type SessionConfig } from "@/hooks/session/useSession";
import { useEditDiffs } from "@/hooks/diffs/useEditDiffs";
import { EditDiffsProvider } from "@/hooks/diffs/EditDiffsContext";
import { SessionCwdProvider } from "@/hooks/session/SessionCwdContext";

// Stable default values for non-streaming messages (enables memo to skip re-renders)

// Only defer rendering for sessions above this threshold (avoids skeleton flash for small sessions)
const DEFERRED_MESSAGE_THRESHOLD = 10;

type SessionOpenSyncMode = "subscribe-live" | "catch-up-unread" | "none";

function resolveSessionOpenSyncMode({
  isSessionRunning,
  isSessionActive,
  hasQueuedMessages,
  isSessionUnread,
  unreadCatchupDone,
}: {
  isSessionRunning: boolean;
  isSessionActive: boolean;
  hasQueuedMessages: boolean;
  isSessionUnread: boolean;
  unreadCatchupDone: boolean;
}): SessionOpenSyncMode {
  if (isSessionRunning || isSessionActive || hasQueuedMessages) {
    return "subscribe-live";
  }
  if (isSessionUnread && !unreadCatchupDone) {
    return "catch-up-unread";
  }
  return "none";
}

// ============================================================================
// Session View Skeleton
// ============================================================================

function SessionViewSkeleton() {
  return (
    <div className="h-full space-y-4 p-4 bg-muted/50">
      {/* User message skeleton */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
      {/* Assistant message skeleton */}
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      {/* User message skeleton */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      {/* Assistant message skeleton */}
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      {/* User message skeleton */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-52 rounded-lg" />
      </div>
      {/* Assistant message skeleton */}
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-60" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-44" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Session View Component
// ============================================================================

export interface SessionViewProps {
  sessionId: string;
  isSessionRunning?: boolean;
  isSessionUnread?: boolean;
  onBack?: () => void;
  models?: ModelInfo[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  readOnly?: boolean; // Hide input area for preview mode
  draftSessionId?: string | null; // ID of the current draft session (if any)
  onDraftSessionCreated?: (sessionId: string) => void; // Called when draft becomes real session
}

export function SessionView({
  sessionId,
  isSessionRunning = false,
  isSessionUnread = false,
  onBack,
  models,
  selectedModel,
  onModelChange,
  readOnly = false,
  draftSessionId,
  onDraftSessionCreated,
}: SessionViewProps) {
  // Check if this is a draft session (not yet created on server)
  const isDraft = sessionId === draftSessionId;

  const queryClient = useQueryClient();

  const { data: sessionsState } = useQuery({
    ...sessionQueries.state(),
    enabled: !readOnly,
  });
  const sessionContext = useMemo(
    () => sessionsState?.sessions.find((session) => session.sessionId === sessionId)?.context,
    [sessionId, sessionsState],
  );
  const directoryOptions = useMemo<SessionDirectoryOption[]>(() => {
    const rawOptions =
      sessionsState?.sessions.reduce<SessionDirectoryOption[]>((acc, session) => {
        const cwd = session.context?.cwd?.trim();
        if (!cwd) return acc;

        acc.push({
          cwd,
          repository: session.context?.repository,
          gitRoot: session.context?.gitRoot,
        });
        return acc;
      }, []) ?? [];

    return normalizeSessionDirectoryOptions(rawOptions);
  }, [sessionsState]);
  const initialDraftDirectory = useMemo(
    () => sessionContext?.cwd ?? directoryOptions[0]?.cwd,
    [directoryOptions, sessionContext?.cwd],
  );
  const [draftDirectory, setDraftDirectory] = useState<string | undefined>(initialDraftDirectory);
  const draftDirectoryRef = useRef<string | undefined>(initialDraftDirectory);
  useEffect(() => {
    if (!isDraft) return;
    setDraftDirectory(undefined);
  }, [isDraft, sessionId]);
  useEffect(() => {
    if (!isDraft) return;
    setDraftDirectory((current) => current ?? initialDraftDirectory);
  }, [isDraft, initialDraftDirectory]);

  const selectedDirectory = isDraft
    ? (draftDirectory ?? initialDraftDirectory)
    : sessionContext?.cwd;
  const selectedDirectoryOption = useMemo(
    () => findSessionDirectoryOption(directoryOptions, selectedDirectory),
    [directoryOptions, selectedDirectory],
  );
  const selectedRepository = isDraft
    ? selectedDirectoryOption?.repository
    : (sessionContext?.repository ?? selectedDirectoryOption?.repository);
  const selectedGitRoot = isDraft
    ? selectedDirectoryOption?.gitRoot
    : (sessionContext?.gitRoot ?? selectedDirectoryOption?.gitRoot);
  useEffect(() => {
    if (!isDraft) return;
    draftDirectoryRef.current = selectedDirectory;
  }, [isDraft, selectedDirectory]);
  const handleDirectoryChange = useCallback((nextDirectory: string) => {
    draftDirectoryRef.current = nextDirectory;
    setDraftDirectory(nextDirectory);
  }, []);

  // Local picker state representing the user's current model intention.
  // For drafts this is seeded from the user-scoped default (localStorage);
  // for existing sessions it stays undefined until the user explicitly picks.
  const [pendingModel, setPendingModel] = useState<string | undefined>(
    isDraft ? selectedModel : undefined,
  );

  // Re-seed when switching to a different session: drafts start with the
  // user's default, existing sessions defer to the server.
  useEffect(() => {
    setPendingModel(isDraft ? selectedModel : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per session switch
  }, [sessionId]);

  // When the user explicitly picks a model, persist to localStorage AND
  // update the local pending selection so it takes effect immediately.
  const handleModelChange = useCallback(
    (modelId: string) => {
      setPendingModel(modelId);
      onModelChange?.(modelId);
    },
    [onModelChange],
  );

  // Session config passed to useSession. Directory and the creation callback
  // only matter for draft sessions but are safely ignored after the first
  // message. The model is only forwarded when there is a local selection that
  // should drive the server request.
  const sessionConfig = useMemo<SessionConfig | undefined>(() => {
    return {
      model: pendingModel,
      directory: selectedDirectory,
      onSessionCreated: isDraft ? () => onDraftSessionCreated?.(sessionId) : undefined,
    };
  }, [isDraft, pendingModel, selectedDirectory, sessionId, onDraftSessionCreated]);

  const {
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    todos,
    revision,
    hasSynced,
    sendMessage,
    updateState,
    attachToStream,
    detachFromStream,
    cancelStream,
    cancelQueuedMessage,
  } = useSession(sessionId, sessionConfig);

  // Session data from cache - disabled for draft sessions (they don't exist on server yet)
  // and while streaming (local state is authoritative during a stream).
  const {
    data: sessionData,
    error,
    dataUpdatedAt: sessionDataUpdatedAt,
  } = useQuery({
    ...sessionQueries.detail(sessionId),
    enabled: !isDraft && !isStreaming,
  });

  // Check if this is a "session not found" error
  const isSessionNotFound = error?.message?.includes("Session not found");

  // For persisted sessions, the replayed session model is authoritative once
  // it arrives. During the draft→active transition, pendingModel (seeded from
  // the user's default) bridges the gap until sessionModel loads.
  const sessionModel = sessionData?.model;
  const displayedModel = pendingModel ?? sessionModel;
  const showModelPicker = isDraft || displayedModel !== undefined || hasSynced;

  // Once the session model catches up to the pending selection,
  // drop the local shadow so later server-side changes are visible again.
  useEffect(() => {
    if (!pendingModel) return;
    if (sessionModel === pendingModel) {
      setPendingModel(undefined);
    }
  }, [sessionModel, pendingModel]);

  // Defer message list rendering for large sessions to keep sidebar selection responsive.
  // During streaming or for small sessions, use real messages for instant updates.
  const deferredMessages = useDeferredValue(messages);
  const renderedMessages =
    isStreaming || messages.length < DEFERRED_MESSAGE_THRESHOLD || deferredMessages.length === 0
      ? messages
      : deferredMessages;

  // Show skeleton only on initial load (before the first sync for this session).
  // Draft sessions skip the skeleton entirely since they start empty. Background
  // refetches and visibility returns update messages in-place without flashing.
  const isHydratingSession = !isDraft && !hasSynced;

  // Sync messages from server when data arrives (guarded against streaming)
  // For draft sessions, sync immediately with empty state
  useEffect(() => {
    if (isDraft) {
      // Draft sessions start with empty state
      updateState([], []);
    } else if (sessionData?.messages) {
      updateState(
        sessionData.messages,
        sessionData.queuedMessages ?? [],
        sessionData.todos,
        sessionData.lastSeenEventId,
        sessionData.status,
        sessionData.reasoningContent,
      );
    }
  }, [isDraft, sessionData, updateState]);

  // ---------------------------------------------------------------------------
  // Page Visibility: Abort on background, resubscribe on foreground
  // ---------------------------------------------------------------------------
  // On mobile, users can background the app or lock their phone without
  // unmounting components. We handle this by:
  // - Aborting the stream when the page becomes hidden (server continues buffering)
  // - Setting a flag to trigger resubscription when the page becomes visible
  const isVisible = usePageVisibility();
  const prevVisibleRef = useRef(true);
  const [resubscribeRequested, setResubscribeRequested] = useState(false);

  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    if (wasVisible === isVisible) return;
    prevVisibleRef.current = isVisible;

    if (!isVisible) {
      // Page hidden → detach client stream (server continues buffering)
      // Note: We use detachFromStream(), not cancelStream(), because we don't want
      // to cancel the server-side processing - just detach the client.
      detachFromStream();
    } else {
      // Page shown → refetch session state and flag for resubscription
      setResubscribeRequested(true);
      queryClient.invalidateQueries({
        queryKey: sessionQueries.detail(sessionId).queryKey,
      });
    }
  }, [isVisible, sessionId, detachFromStream, queryClient]);

  // Subscribe to live events after initial sync OR after returning from background.
  // Fires when the session is actively processing OR when it's idle but has
  // queued messages that were never drained (e.g., the user navigated away
  // before the previous turn finished, and the queue was never consumed).
  // We also subscribe when the list/SSE layer marks this session as running so
  // open details in other tabs attach immediately on cross-client turns.
  //
  // IMPORTANT: We use a ref for isStreaming check instead of including it in deps.
  // This prevents the effect from re-running when streaming ends, which could cause
  // a loop: stream ends → effect re-runs → resubscribe → repeat.
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const unreadCatchupDoneRef = useRef(false);
  const unreadCatchupSessionRef = useRef(sessionId);
  if (unreadCatchupSessionRef.current !== sessionId) {
    unreadCatchupSessionRef.current = sessionId;
    unreadCatchupDoneRef.current = false;
  }

  const hasQueuedMessages = (sessionData?.queuedMessages?.length ?? 0) > 0;
  const isSessionActive = sessionData?.status !== undefined && sessionData.status !== "idle";
  useEffect(() => {
    if (isDraft) return;
    if (!isVisible || !hasSynced || isStreamingRef.current) return;

    const syncMode = resolveSessionOpenSyncMode({
      isSessionRunning,
      isSessionActive,
      hasQueuedMessages,
      isSessionUnread,
      unreadCatchupDone: unreadCatchupDoneRef.current,
    });

    const clearResubscribeRequest = () => {
      if (resubscribeRequested) {
        setResubscribeRequested(false);
      }
    };

    if (syncMode === "catch-up-unread") {
      unreadCatchupDoneRef.current = true;
      void queryClient.invalidateQueries({
        queryKey: sessionQueries.detail(sessionId).queryKey,
      });
      clearResubscribeRequest();
      return;
    }

    if (syncMode === "none") {
      clearResubscribeRequest();
      return;
    }

    attachToStream();
    clearResubscribeRequest();
  }, [
    isDraft,
    isVisible,
    hasSynced,
    isSessionUnread,
    isSessionRunning,
    isSessionActive,
    hasQueuedMessages,
    queryClient,
    sessionId,
    sessionDataUpdatedAt,
    resubscribeRequested,
    attachToStream,
  ]);

  // Ref to hold scrollToBottom function from the StickToBottom context
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // Handle message submission
  const handleSubmit = useCallback(
    (text: string, attachments: Attachment[]) => {
      sendMessage(
        text,
        attachments,
        isDraft ? { directory: draftDirectoryRef.current } : undefined,
      );

      // Force scroll to bottom after submitting a message
      scrollToBottomRef.current?.();
    },
    [isDraft, sendMessage],
  );

  // Compute total diff stats for all edit tool calls in the session
  const editDiffs = useEditDiffs(messages, selectedDirectory);
  const sessionDiff = useMemo(
    () => ({ total: editDiffs.total, byFile: editDiffs.byFile }),
    [editDiffs.total, editDiffs.byFile],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Mobile Back Button Bar - Hidden entirely in read-only mode */}
      {!readOnly && onBack && (
        <div className="p-2 pt-0 border-b bg-background md:hidden shrink-0 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Sessions
          </Button>
          <div className="flex min-w-0 items-center gap-1.5">
            <SessionDirectoryPicker
              value={selectedDirectory}
              repository={selectedRepository}
              gitRoot={selectedGitRoot}
              options={directoryOptions}
              onValueChange={isDraft ? handleDirectoryChange : undefined}
              disabled={!isDraft}
            />
            <SessionMetadataBadges messageCount={messages.length} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {isSessionNotFound ? (
          <div className="h-full flex flex-col items-center justify-center bg-muted/50 p-4 text-center">
            <p className="text-muted-foreground mb-2">Session not found</p>
            <p className="text-sm text-muted-foreground/70 mb-4">
              This session may have been deleted or is no longer available.
            </p>
            {onBack && (
              <Button variant="outline" size="sm" onClick={onBack}>
                Go back
              </Button>
            )}
          </div>
        ) : isHydratingSession ? (
          <SessionViewSkeleton />
        ) : (
          <SessionCwdProvider value={selectedDirectory}>
            <EditDiffsProvider value={editDiffs.byToolCallId}>
              <MessageList
                messages={renderedMessages}
                isStreaming={isStreaming}
                status={status}
                reasoningContent={reasoningContent}
                revision={revision}
                hasSynced={hasSynced}
                scrollToBottomRef={scrollToBottomRef}
              />
            </EditDiffsProvider>
          </SessionCwdProvider>
        )}
      </div>

      {!readOnly && !isSessionNotFound && (
        <div className="px-4 pt-4 md:pb-4 border-t bg-background shrink-0">
          <SessionInput
            onSubmit={handleSubmit}
            isStreaming={isStreaming}
            onStop={cancelStream}
            models={showModelPicker ? models : undefined}
            selectedModel={displayedModel}
            onModelChange={handleModelChange}
            directoryOptions={directoryOptions}
            selectedDirectory={selectedDirectory}
            selectedRepository={selectedRepository}
            selectedGitRoot={selectedGitRoot}
            onDirectoryChange={isDraft ? handleDirectoryChange : undefined}
            directoryPickerDisabled={!isDraft}
            showDirectoryPicker={!onBack}
            todos={todos}
            sessionDiff={sessionDiff}
            queuedMessages={queuedMessages}
            onCancelQueuedMessage={cancelQueuedMessage}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Message List Component
// ============================================================================

const MessageList = memo(function MessageList({
  messages,
  isStreaming,
  status,
  reasoningContent,
  revision,
  hasSynced,
  scrollToBottomRef,
}: {
  messages: Message[];
  isStreaming: boolean;
  status: SessionStatus;
  reasoningContent: string;
  revision: number;
  hasSynced: boolean;
  scrollToBottomRef: React.MutableRefObject<(() => void) | null>;
}) {
  // Only show empty state if messages have been synced from server and there are none
  // This prevents the "Start a conversation" flash while loading/syncing
  if (messages.length === 0) {
    if (!hasSynced) {
      return <SessionViewSkeleton />;
    }
    return (
      <div className="h-full flex items-center justify-center bg-muted/50 p-8">
        <div className="text-center space-y-4">
          <Bot className="h-16 w-16 mx-auto text-muted-foreground/50" />
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">What would you like to build?</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Ask a question or describe your idea below
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Use instant scroll when not streaming (loading session, switching sessions)
  // Use smooth scroll only during active streaming.
  // We handle initial scroll ourselves in MessageListContent to prevent flash,
  // so disable the library's initial scroll behavior.
  return (
    <StickToBottom
      className="h-full bg-muted/50 relative"
      resize={isStreaming ? "smooth" : "instant"}
      initial={false}
    >
      <MessageListContent
        messages={messages}
        isStreaming={isStreaming}
        status={status}
        reasoningContent={reasoningContent}
        revision={revision}
        scrollToBottomRef={scrollToBottomRef}
      />
      <ScrollToBottomButton />
    </StickToBottom>
  );
});

// Inner component that handles initial scroll positioning to prevent flash.
// The library's ResizeObserver-based scroll happens after first paint, causing a visible jump.
// We hide content until positioned, then let the library handle streaming updates.
// Uses direct DOM manipulation to avoid re-render overhead.
function MessageListContent({
  messages,
  isStreaming,
  status,
  reasoningContent,
  revision,
  scrollToBottomRef,
}: {
  messages: Message[];
  isStreaming: boolean;
  status: SessionStatus;
  reasoningContent: string;
  revision: number;
  scrollToBottomRef: React.MutableRefObject<(() => void) | null>;
}) {
  const { scrollRef, scrollToBottom } = useStickToBottomContext();
  const contentRef = useRef<HTMLDivElement>(null);

  // Expose scrollToBottom to parent components via ref
  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom, scrollToBottomRef]);

  // Position scroll and reveal content before browser paints.
  // Direct DOM mutation avoids a re-render cycle.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    scrollEl.scrollTop = scrollEl.scrollHeight;
    contentEl.style.opacity = "1";

    // Keep `initial={false}` to avoid smooth-scrolling long histories, but
    // sync the library's internal lock state to bottom immediately.
    void scrollToBottom({ animation: "instant", ignoreEscapes: true });
  }, [scrollRef, scrollToBottom]);

  return (
    <StickToBottom.Content className="@container space-y-4 p-4 overflow-x-hidden">
      <div ref={contentRef} className="space-y-3" style={{ opacity: 0 }}>
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          return (
            <SessionMessage
              key={`${message.role}-${index}`}
              message={message}
              isStreaming={isLast && isStreaming}
              revision={isLast ? revision : message.revision}
            />
          );
        })}

        {/* Session status shown at the bottom of the message list while streaming */}
        {isStreaming && reasoningContent && <ReasoningDisplay content={reasoningContent} />}
        {isStreaming && status !== "idle" && <StatusIndicator status={status} />}
      </div>
    </StickToBottom.Content>
  );
}

// ============================================================================
// Scroll To Bottom Button
// ============================================================================

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <Button
      variant="secondary"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg bg-background"
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
      Scroll down
    </Button>
  );
}
