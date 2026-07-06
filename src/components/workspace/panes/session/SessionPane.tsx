import { useEffect, useCallback, useMemo, useDeferredValue, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { workspaceStateAtom, workspaceHydratedAtom } from "@/atoms";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import type { Attachment, ModelInfo, ModelConfiguration } from "@/types";
import { sessionQueries, skillQueries } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "./location/SessionLocationPicker";
import type { WorktreeBranchActions } from "./location/git/SessionBranchMenu";
import { SessionMetadataBadges } from "./location/SessionMetadataBadges";
import {
  findSessionDirectoryOption,
  normalizeSessionDirectoryOptions,
  type SessionDirectoryOption,
} from "./location/directory/directoryOptions";
import { useLinkedPanes } from "@/hooks/session/useLinkedPanes";
import { useSession, type SessionConfig } from "@/hooks/session/useSession";
import { useDraftPrompt } from "@/hooks/session/useDraftPrompt";
import { mergeSessionWorktree, applySessionWorktree } from "@/functions/sessions";
import { getSettings } from "@/lib/config/settings";
import { useEditDiffs } from "@/hooks/diffs/useEditDiffs";
import { EditDiffsProvider } from "@/hooks/diffs/EditDiffsContext";
import { SessionCwdProvider } from "@/hooks/session/SessionCwdContext";
import { SessionComposer } from "./composer/SessionComposer";
import { getSessionPaneModeCapabilities, type SessionPaneMode } from "./modes";
import type { PaneProps } from "../types";
import {
  resolveLinkedPanePublishState,
  resolveSessionOpenAction,
  shouldLoadSessionSnapshot,
} from "./policy";
import { SessionMessageList, SessionMessagesSkeleton } from "./transcript/MessageList";

// Only defer rendering for sessions above this threshold (avoids skeleton flash for small sessions)
const DEFERRED_MESSAGE_THRESHOLD = 10;

export interface SessionPaneProps extends PaneProps {
  sessionId: string;
  isSessionRunning?: boolean;
  isSessionUnread?: boolean;
  onBack?: () => void;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
  mode?: SessionPaneMode;
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
  variant = "normal",
  actionsSlot,
}: SessionPaneProps) {
  const { showInput, showArtifactShortcuts, loadGlobalSessionState, ownsLinkedPanes } =
    getSessionPaneModeCapabilities(mode);
  // In the "compact" variant (the pager) the session surfaces its location picker
  // + message badges in the host's title bar and hides them from the composer; in
  // "normal" (the grid) it keeps them inline. See PaneProps.
  const isCompact = variant === "compact";
  const { prompt, setPrompt } = useDraftPrompt(sessionId, { enabled: showInput });

  const queryClient = useQueryClient();
  const workspaceState = useAtomValue(workspaceStateAtom);
  const workspaceHydrated = useAtomValue(workspaceHydratedAtom);

  // ---------------------------------------------------------------------------
  // Session location and creation options
  // ---------------------------------------------------------------------------
  const { data: sessionsState } = useQuery({
    ...sessionQueries.state(),
    enabled: loadGlobalSessionState,
  });
  const sessionMetadata = sessionsState?.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  // A draft is simply a session still in the workspace store — the store drops it
  // the moment it's promoted (session.upserted → removeDraftMembership), so this is
  // the whole test. Until the store hydrates, treat "not found" as loading so a
  // draft URL doesn't fetch a not-yet-persisted session.
  const draft = workspaceState.drafts.find((item) => item.sessionId === sessionId);
  const isDraft = Boolean(draft);
  const isDraftStatusLoading = loadGlobalSessionState && !workspaceHydrated && !isDraft;
  const sessionContext = sessionMetadata?.context;
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
  // Draft directory is tri-state: `undefined` means "not seeded yet" (fall back
  // to the default recent directory), `null` means the user explicitly cleared
  // it, and a string is an explicit choice. Distinguishing cleared from unseeded
  // is what lets a draft be submitted with no working directory, like automations.
  const [draftDirectory, setDraftDirectory] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isDraft) return;
    setDraftDirectory(undefined);
  }, [isDraft, sessionId]);

  const selectedDirectory = !isDraft
    ? sessionContext?.workingDirectory
    : draftDirectory === undefined
      ? initialDraftDirectory
      : (draftDirectory ?? undefined);
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

  // Active worktree sessions expose merge/apply actions through the location picker.
  const worktreeActions = useMemo<WorktreeBranchActions | undefined>(() => {
    if (!isWorktreeSession) return undefined;
    return {
      worktreeBranch: worktree?.branch,
      worktreeBaseBranch: worktree?.baseBranch,
      onMerge: handleMerge,
      onApply: handleApply,
      isWorktreeBusy,
    };
  }, [isWorktreeSession, worktree, handleMerge, handleApply, isWorktreeBusy]);

  // Shared between the desktop composer and mobile header.
  const hasLocation = isDraft || Boolean(selectedDirectory) || Boolean(worktreeActions);
  const locationPickerProps = useMemo<SessionLocationPickerProps | undefined>(() => {
    if (!hasLocation) return undefined;
    return {
      value: selectedDirectory,
      repository: selectedRepository,
      gitRoot: selectedGitRoot,
      options: directoryOptions,
      onValueChange: isDraft ? (next) => setDraftDirectory(next ?? null) : undefined,
      disabled: !isDraft,
      useWorktree: isDraft ? useWorktree : undefined,
      onUseWorktreeChange: isDraft ? setUseWorktree : undefined,
      branch: sessionContext?.branch,
      worktreeActions,
    };
  }, [
    hasLocation,
    selectedDirectory,
    selectedRepository,
    selectedGitRoot,
    directoryOptions,
    isDraft,
    useWorktree,
    sessionContext?.branch,
    worktreeActions,
  ]);

  // Session config passed to useSession. The session's model configuration is
  // owned by useSession's reducer state (seeded on first send, updated by
  // model_changed events and snapshot syncs); the global picker state is only
  // forwarded as the default for a draft's first message. Directory and
  // draft metadata only matter for draft sessions but are safely ignored by
  // useSession after the first message.
  const sessionConfig = useMemo<SessionConfig | undefined>(() => {
    return {
      isDraftSession: isDraft || isDraftStatusLoading,
      defaultModelConfiguration: modelConfiguration ?? undefined,
      directory: selectedDirectory,
      useWorktree: isDraft ? useWorktree : undefined,
      draftSession: isDraft ? draft : undefined,
    };
  }, [draft, isDraft, isDraftStatusLoading, modelConfiguration, selectedDirectory, useWorktree]);

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
    hasLoadedSessionState,
    sendMessage,
    initializeDraft,
    syncSnapshot,
    setModelConfiguration,
    attachToStream,
    detachFromStream,
    stopStream,
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

  // ---------------------------------------------------------------------------
  // Session snapshot and linked panes
  // ---------------------------------------------------------------------------
  // Wait until draft status is known, then skip drafts (no persisted snapshot
  // yet) and streaming sessions (local state wins).
  const {
    data: sessionSnapshot,
    error,
    dataUpdatedAt: sessionSnapshotUpdatedAt,
  } = useQuery({
    ...sessionQueries.detail(sessionId),
    enabled: shouldLoadSessionSnapshot({
      isDraft,
      isStreaming,
      isDraftStatusLoading,
    }),
  });

  // Skills are directory-scoped — fetch once per CWD, shared across sessions.
  // The stream-based path (session.skills_loaded → useSession cache prime) populates
  // this for live sessions; the query here covers cold sessions via RPC fallback.
  const { data: skills } = useQuery({
    ...skillQueries.list(sessionId, selectedDirectory!),
    enabled: !isDraft && !!selectedDirectory,
  });
  const hasSessionSnapshot = sessionSnapshot !== undefined;
  const snapshotLinkedSessionIds = sessionSnapshot?.linkedSessionIds;
  const snapshotCanvases = sessionSnapshot?.canvases;
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
      hasSessionSnapshot,
      sessionSnapshot: {
        linkedSessionIds: snapshotLinkedSessionIds,
        canvases: snapshotCanvases,
      },
    });
    if (!publishState || !ownsLinkedPanes) return;

    publishSessionPanes(sessionId, publishState.linkedSessionIds, publishState.canvases, artifacts);
  }, [
    artifacts,
    canvases,
    hasSessionSnapshot,
    isDraft,
    isStreaming,
    linkedSessionIds,
    ownsLinkedPanes,
    snapshotLinkedSessionIds,
    snapshotCanvases,
    sessionId,
    publishSessionPanes,
  ]);

  // ---------------------------------------------------------------------------
  // Session state sync and stream attachment
  // ---------------------------------------------------------------------------
  // Sync local state from the authoritative source for the current lifecycle phase.
  // Drafts initialize empty exactly once; after the first optimistic send they remain
  // drafts until the server creates a persisted session, so rerunning this branch would
  // erase the optimistic user message or any send-failure error. Active streams keep
  // live reducer state authoritative and skip snapshots until the stream settles.
  // Any field added to SessionSnapshot must either be event-conveyed during a
  // live stream or be correct in the cache before attach.
  useEffect(() => {
    if (isDraft) {
      if (hasLoadedSessionState) return;
      initializeDraft();
      return;
    }

    if (isStreaming || !sessionSnapshot?.messages) return;
    syncSnapshot(sessionSnapshot);
  }, [initializeDraft, isDraft, hasLoadedSessionState, isStreaming, sessionSnapshot, syncSnapshot]);

  // ---------------------------------------------------------------------------
  // Page Visibility: detach on background, resubscribe on foreground
  // ---------------------------------------------------------------------------
  // On mobile, users can background the app or lock their phone without
  // unmounting components. We handle this by:
  // - Detaching from the stream when the page becomes hidden (server continues buffering)
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
      // Note: We use detachFromStream(), not stopStream(), because we don't want
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
  // open panes in other tabs attach immediately on cross-client turns.
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

  const hasQueuedMessages = (sessionSnapshot?.queuedMessages?.length ?? 0) > 0;
  const isSessionActive =
    sessionSnapshot?.status !== undefined && sessionSnapshot.status !== "idle";
  useEffect(() => {
    if (isDraft) return;
    if (!isVisible || !hasLoadedSessionState || isStreamingRef.current) return;

    const openAction = resolveSessionOpenAction({
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

    if (openAction === "catch-up-unread") {
      unreadCatchupDoneRef.current = true;
      void queryClient.invalidateQueries({
        queryKey: sessionQueries.detail(sessionId).queryKey,
      });
      clearResubscribeRequest();
      return;
    }

    if (openAction === "none") {
      clearResubscribeRequest();
      return;
    }

    attachToStream();
    clearResubscribeRequest();
  }, [
    isDraft,
    isVisible,
    hasLoadedSessionState,
    isSessionUnread,
    isSessionRunning,
    isSessionActive,
    hasQueuedMessages,
    queryClient,
    sessionId,
    sessionSnapshotUpdatedAt,
    resubscribeRequested,
    attachToStream,
  ]);

  // ---------------------------------------------------------------------------
  // Render state and handlers
  // ---------------------------------------------------------------------------
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  const handleSubmit = useCallback(
    (text: string, attachments: Attachment[]) => {
      sendMessage(text, attachments, isDraft ? { directory: selectedDirectory } : undefined);

      // Force scroll to bottom after submitting a message
      scrollToBottomRef.current?.();
    },
    [isDraft, sendMessage, selectedDirectory],
  );

  const editDiffs = useEditDiffs(messages, selectedDirectory);
  const sessionDiff = useMemo(
    () => ({ total: editDiffs.total, byFile: editDiffs.byFile }),
    [editDiffs.total, editDiffs.byFile],
  );
  const isSessionNotFound =
    !isDraft && !isDraftStatusLoading && error?.message?.includes("Session not found");
  const canShowComposer = showInput && !isSessionNotFound;

  // Defer message list rendering for large sessions to keep sidebar selection responsive.
  // During streaming or for small sessions, use real messages for instant updates.
  const deferredMessages = useDeferredValue(messages);
  const renderedMessages =
    isStreaming || messages.length < DEFERRED_MESSAGE_THRESHOLD || deferredMessages.length === 0
      ? messages
      : deferredMessages;

  // Show skeleton only on initial load. Draft sessions skip it since they
  // start empty; background refetches update messages in place.
  const isLoadingSessionState = !isDraft && !hasLoadedSessionState;

  return (
    <div className="flex flex-col h-full">
      {/* In the "compact" variant, surface the session's location + message count in
          the host's title bar by declaring them into the slot it provides. */}
      {isCompact &&
        actionsSlot &&
        showInput &&
        createPortal(
          <div className="flex min-w-0 items-center gap-1.5">
            {locationPickerProps && (
              // md:pe-0 trims the picker button's trailing padding in the hyper deck
              // (desktop) so it sits as tight to the edge as the other actions. It must be
              // the logical `pe` (padding-inline-end): the button's base padding is `px`,
              // which is `padding-inline` in Tailwind v4, so a physical `pr` wouldn't win.
              // The mobile pager keeps the default padding.
              <SessionLocationPicker {...locationPickerProps} className="md:pe-0" />
            )}
            <SessionMetadataBadges messageCount={messages.length} />
          </div>,
          actionsSlot,
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
        ) : isLoadingSessionState ? (
          <SessionMessagesSkeleton />
        ) : (
          <SessionCwdProvider value={selectedDirectory}>
            <EditDiffsProvider value={editDiffs.byToolCallId}>
              <SessionMessageList
                messages={renderedMessages}
                isStreaming={isStreaming}
                status={status}
                reasoningContent={reasoningContent}
                revision={revision}
                scrollToBottomRef={scrollToBottomRef}
              />
            </EditDiffsProvider>
          </SessionCwdProvider>
        )}
      </div>

      {canShowComposer && (
        <div className="px-4 pt-4 md:pb-4 border-t bg-background shrink-0">
          <SessionComposer
            sessionId={sessionId}
            value={prompt}
            onValueChange={setPrompt}
            onSubmit={handleSubmit}
            canSubmit={!isDraftStatusLoading}
            isStreaming={isStreaming}
            onStop={stopStream}
            models={models}
            modelConfiguration={displayedModelConfiguration}
            onModelConfigurationChange={handleModelConfigurationChange}
            locationPicker={isCompact ? undefined : locationPickerProps}
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
