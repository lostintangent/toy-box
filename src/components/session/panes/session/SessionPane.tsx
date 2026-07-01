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
import type { Attachment, Message, ModelInfo, ModelConfiguration, SessionCanvas } from "@/types";
import { sessionQueries, skillQueries } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Message as SessionMessage } from "../../messages/Message";
import { StatusIndicator, ReasoningDisplay } from "../../SessionStatus";
import type { SessionStatus } from "@/types";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "../../SessionLocationPicker";
import type { WorktreeProps } from "../../WorktreeBranchMenu";
import { SessionMetadataBadges } from "../../SessionMetadataBadges";
import {
  findSessionDirectoryOption,
  normalizeSessionDirectoryOptions,
  type SessionDirectoryOption,
} from "../../sessionDirectoryOptions";
import { SessionInput } from "../../input/SessionInput";
import { useLinkedPanes } from "@/hooks/session/useLinkedPanes";
import { useSession, type SessionConfig } from "@/hooks/session/useSession";
import { mergeSessionWorktree, applySessionWorktree } from "@/functions/sessions";
import { getSettings } from "@/lib/config/settings";
import { useEditDiffs } from "@/hooks/diffs/useEditDiffs";
import { EditDiffsProvider } from "@/hooks/diffs/EditDiffsContext";
import { SessionCwdProvider } from "@/hooks/session/SessionCwdContext";
import { resolveSessionStateSyncAction } from "@/lib/session/sessionSync";
import { getSessionPaneModeCapabilities, type SessionPaneMode } from "./modes";

// Only defer rendering for sessions above this threshold (avoids skeleton flash for small sessions)
const DEFERRED_MESSAGE_THRESHOLD = 10;

type SessionOpenSyncMode = "subscribe-live" | "catch-up-unread" | "none";

type LinkedPanePublishState = { linkedSessionIds: string[]; canvases: SessionCanvas[] } | undefined;

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

function resolveLinkedPanePublishState({
  isDraft,
  isStreaming,
  linkedSessionIds,
  canvases,
  hasHydratedSessionData,
  sessionData,
}: {
  isDraft: boolean;
  isStreaming: boolean;
  linkedSessionIds: string[];
  canvases: SessionCanvas[] | undefined;
  hasHydratedSessionData: boolean;
  sessionData:
    | {
        linkedSessionIds?: string[];
        canvases?: SessionCanvas[];
      }
    | undefined;
}): LinkedPanePublishState {
  if (isDraft) {
    return { linkedSessionIds: [], canvases: [] };
  }

  if (isStreaming) {
    return { linkedSessionIds, canvases: canvases ?? [] };
  }

  if (!hasHydratedSessionData) {
    return undefined;
  }

  return {
    linkedSessionIds: sessionData?.linkedSessionIds ?? [],
    canvases: sessionData?.canvases ?? [],
  };
}

// ============================================================================
// Session Pane Skeleton
// ============================================================================

function SessionPaneSkeleton() {
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
// Session Pane Component
// ============================================================================

export interface SessionPaneProps {
  sessionId: string;
  isSessionRunning?: boolean;
  isSessionUnread?: boolean;
  onBack?: () => void;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
  mode?: SessionPaneMode;
  draftSessionId?: string | null; // ID of the current draft session (if any)
  onDraftSessionCreated?: (sessionId: string) => void; // Called when draft becomes real session
}

export function SessionPane({
  sessionId,
  isSessionRunning = false,
  isSessionUnread = false,
  onBack,
  models,
  modelConfiguration,
  onModelConfigurationChange,
  mode = "interactive",
  draftSessionId,
  onDraftSessionCreated,
}: SessionPaneProps) {
  const { showInput, showArtifactShortcuts, loadGlobalSessionState, ownsLinkedPanes } =
    getSessionPaneModeCapabilities(mode);
  // Check if this is a draft session (not yet created on server)
  const isDraft = sessionId === draftSessionId;

  const queryClient = useQueryClient();

  const { data: sessionsState } = useQuery({
    ...sessionQueries.state(),
    enabled: loadGlobalSessionState,
  });
  const sessionContext = useMemo(
    () => sessionsState?.sessions.find((session) => session.sessionId === sessionId)?.context,
    [sessionId, sessionsState],
  );
  const worktree = sessionsState?.worktrees[sessionId];
  const isWorktreeSession = !isDraft && Boolean(worktree?.branch);
  const directoryOptions = useMemo<SessionDirectoryOption[]>(() => {
    const rawOptions =
      sessionsState?.sessions.reduce<SessionDirectoryOption[]>((acc, session) => {
        const cwd = session.context?.workingDirectory?.trim();
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
    () => sessionContext?.workingDirectory ?? directoryOptions[0]?.cwd,
    [directoryOptions, sessionContext?.workingDirectory],
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
    : sessionContext?.workingDirectory;
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
  const handleDirectoryChange = useCallback((nextDirectory: string | undefined) => {
    draftDirectoryRef.current = nextDirectory;
    setDraftDirectory(nextDirectory);
  }, []);

  // Worktree toggle state — seeded from settings, local to this draft session
  const [useWorktree, setUseWorktree] = useState(() =>
    isDraft ? getSettings().useWorktree : false,
  );
  useEffect(() => {
    if (isDraft) setUseWorktree(getSettings().useWorktree);
  }, [isDraft, sessionId]);

  // Worktree operations — only relevant for non-draft worktree sessions
  const [isWorktreeBusy, setIsWorktreeBusy] = useState(false);
  const handleMerge = useCallback(async () => {
    setIsWorktreeBusy(true);
    try {
      await mergeSessionWorktree({ data: { sessionId } });
    } catch (error) {
      console.error("Failed to merge worktree:", error);
    } finally {
      setIsWorktreeBusy(false);
    }
  }, [sessionId]);

  const handleApply = useCallback(async () => {
    setIsWorktreeBusy(true);
    try {
      await applySessionWorktree({ data: { sessionId } });
    } catch (error) {
      console.error("Failed to apply worktree:", error);
    } finally {
      setIsWorktreeBusy(false);
    }
  }, [sessionId]);

  // Bundled worktree props — passed to the location picker for active worktree sessions
  const worktreeProps = useMemo<WorktreeProps | undefined>(() => {
    if (!isWorktreeSession) return undefined;
    return {
      worktreeBranch: worktree?.branch,
      worktreeBaseBranch: worktree?.baseBranch,
      onMerge: handleMerge,
      onApply: handleApply,
      isWorktreeBusy,
    };
  }, [isWorktreeSession, worktree, handleMerge, handleApply, isWorktreeBusy]);

  // Bundled location picker props — shared between mobile header and input bar.
  // Desktop shows the picker inside the input; mobile shows it in the back-button bar.
  const hasLocation = isDraft || Boolean(selectedDirectory) || Boolean(worktreeProps);
  const locationPickerProps = useMemo<SessionLocationPickerProps | undefined>(() => {
    if (!hasLocation) return undefined;
    return {
      value: selectedDirectory,
      repository: selectedRepository,
      gitRoot: selectedGitRoot,
      options: directoryOptions,
      onValueChange: isDraft ? handleDirectoryChange : undefined,
      disabled: !isDraft,
      useWorktree: isDraft ? useWorktree : undefined,
      onUseWorktreeChange: isDraft ? setUseWorktree : undefined,
      branch: sessionContext?.branch,
      worktreeProps,
    };
  }, [
    hasLocation,
    selectedDirectory,
    selectedRepository,
    selectedGitRoot,
    directoryOptions,
    isDraft,
    handleDirectoryChange,
    useWorktree,
    sessionContext?.branch,
    worktreeProps,
  ]);

  // Session config passed to useSession. The session's model configuration is
  // owned by useSession's reducer state (seeded on first send, updated by
  // model_changed events and snapshot syncs); the global picker state is only
  // forwarded as the default for a draft's first message. Directory and the
  // creation callback only matter for draft sessions but are safely ignored
  // by useSession after the first message.
  const sessionConfig = useMemo<SessionConfig | undefined>(() => {
    return {
      isDraft,
      defaultModelConfiguration: modelConfiguration ?? undefined,
      directory: selectedDirectory,
      useWorktree: isDraft ? useWorktree : undefined,
      onSessionCreated: isDraft ? () => onDraftSessionCreated?.(sessionId) : undefined,
    };
  }, [
    isDraft,
    modelConfiguration,
    selectedDirectory,
    useWorktree,
    sessionId,
    onDraftSessionCreated,
  ]);

  const {
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    modelConfiguration: sessionModelConfiguration,
    todos,
    linkedSessionIds,
    canvases,
    artifacts,
    revision,
    hasSynced,
    sendMessage,
    updateState,
    setModelConfiguration,
    attachToStream,
    detachFromStream,
    cancelStream,
    cancelQueuedMessage,
  } = useSession(sessionId, sessionConfig);

  // Session state wins over the global picker state. Draft sessions fall back
  // to the current global configuration until the first send seeds their own.
  // Existing sessions show a loading skeleton until their snapshot syncs.
  const displayedModelConfiguration = useMemo<ModelConfiguration | null>(
    () => sessionModelConfiguration ?? (isDraft ? (modelConfiguration ?? null) : null),
    [isDraft, modelConfiguration, sessionModelConfiguration],
  );

  // When the user explicitly picks a model, persist to localStorage AND
  // update the session's state so it takes effect immediately.
  const handleModelConfigurationChange = useCallback(
    (configuration: ModelConfiguration) => {
      setModelConfiguration(configuration);
      onModelConfigurationChange?.(configuration);
    },
    [onModelConfigurationChange, setModelConfiguration],
  );

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

  // Skills are directory-scoped — fetch once per CWD, shared across sessions.
  // The stream-based path (session.skills_loaded → useSession cache prime) populates
  // this for live sessions; the query here covers cold sessions via RPC fallback.
  const { data: skills } = useQuery({
    ...skillQueries.list(sessionId, selectedDirectory!),
    enabled: !isDraft && !!selectedDirectory,
  });
  const hasHydratedSessionData = sessionData !== undefined;
  const sessionDataLinkedSessionIds = sessionData?.linkedSessionIds;
  const sessionDataCanvases = sessionData?.canvases;
  const { publishSessionPanes, clearSessionPanes } = useLinkedPanes();

  useEffect(() => {
    if (!ownsLinkedPanes) return;
    return () => clearSessionPanes(sessionId);
  }, [clearSessionPanes, ownsLinkedPanes, sessionId]);

  useEffect(() => {
    const publishState = resolveLinkedPanePublishState({
      isDraft,
      isStreaming,
      linkedSessionIds,
      canvases,
      hasHydratedSessionData,
      sessionData: {
        linkedSessionIds: sessionDataLinkedSessionIds,
        canvases: sessionDataCanvases,
      },
    });
    if (!publishState || !ownsLinkedPanes) return;

    publishSessionPanes(sessionId, publishState.linkedSessionIds, publishState.canvases, artifacts);
  }, [
    artifacts,
    canvases,
    hasHydratedSessionData,
    isDraft,
    isStreaming,
    linkedSessionIds,
    ownsLinkedPanes,
    sessionDataLinkedSessionIds,
    sessionDataCanvases,
    sessionId,
    publishSessionPanes,
  ]);

  // Check if this is a "session not found" error
  const isSessionNotFound = error?.message?.includes("Session not found");

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

  // Sync local state from the authoritative source for the current lifecycle phase.
  // Drafts initialize empty exactly once; after the first optimistic send they remain
  // drafts until the server creates a real session, so rerunning this branch would
  // erase the optimistic user message or any send-failure error. Active streams keep
  // live reducer state authoritative and skip snapshots until the stream settles.
  // Any field added to SessionSnapshot must either be event-conveyed during a
  // live stream or be correct in the cache before attach.
  useEffect(() => {
    const syncAction = resolveSessionStateSyncAction({
      isDraft,
      hasSynced,
      isStreaming,
      hasSnapshot: Boolean(sessionData?.messages),
    });

    if (syncAction === "initialize-draft") {
      updateState({ messages: [] });
    } else if (syncAction === "sync-snapshot" && sessionData?.messages) {
      updateState({
        messages: sessionData.messages,
        queuedMessages: sessionData.queuedMessages,
        todos: sessionData.todos,
        linkedSessionIds: sessionData.linkedSessionIds,
        canvases: sessionData.canvases,
        artifacts: sessionData.artifacts,
        lastSeenEventId: sessionData.lastSeenEventId,
        status: sessionData.status,
        reasoningContent: sessionData.reasoningContent,
        // Restores the session's last-used model so the picker reflects it.
        // Lives in useSession state (not localStorage) — only explicit user
        // picks persist globally.
        modelConfiguration: sessionData.modelConfiguration,
      });
    }
  }, [hasSynced, isDraft, isStreaming, sessionData, updateState]);

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
      {/* Mobile Back Button Bar - Hidden in modes that do not show the composer */}
      {showInput && onBack && (
        <div className="p-2 pt-0 border-b bg-background md:hidden shrink-0 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            Back to Sessions
          </Button>
          <div className="flex min-w-0 items-center gap-1.5">
            {locationPickerProps && <SessionLocationPicker {...locationPickerProps} />}
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
          <SessionPaneSkeleton />
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

      {showInput && !isSessionNotFound && (
        <div className="px-4 pt-4 md:pb-4 border-t bg-background shrink-0">
          <SessionInput
            sessionId={sessionId}
            onSubmit={handleSubmit}
            isStreaming={isStreaming}
            onStop={cancelStream}
            models={models}
            modelConfiguration={displayedModelConfiguration}
            onModelConfigurationChange={handleModelConfigurationChange}
            locationPicker={onBack ? undefined : locationPickerProps}
            todos={todos}
            skills={skills}
            sessionDiff={sessionDiff}
            artifacts={showArtifactShortcuts ? artifacts : []}
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
      return <SessionPaneSkeleton />;
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
              // eslint-disable-next-line react/no-array-index-key -- messages append in order and streaming updates replace content in place
              key={`${message.role}-${index}`}
              message={message}
              isStreaming={isStreaming}
              isLast={isLast}
              revision={
                isLast ? revision : message.role === "assistant" ? message.revision : undefined
              }
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
