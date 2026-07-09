import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { sessionStatusAtom } from "@/hooks/workspace/atoms";
import type { Attachment, ModelConfiguration } from "@/types";
import { sessionQueries, skillQueries } from "@/lib/queries";
import { getRecentDirectories } from "@/lib/session/recentDirectories";
import { Button } from "@/components/ui/button";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "./location/SessionLocationPicker";
import { SessionMetadataBadges } from "./location/SessionMetadataBadges";
import { useLinkedPaneActions } from "@/hooks/workspace/layout/useLinkedPanes";
import { useSession } from "@/hooks/session/useSession";
import { useModels } from "@/hooks/workspace/useModels";
import { useDraftPrompt } from "@/hooks/workspace/useDraftPrompt";
import { mergeSessionWorktree, applySessionWorktree } from "@/functions/sessions";
import { getSettings } from "@/lib/config/settings";
import { useEditDiffs } from "@/hooks/diffs/useEditDiffs";
import { EditDiffsProvider } from "@/hooks/diffs/EditDiffsContext";
import { SessionCwdProvider } from "@/hooks/session/SessionCwdContext";
import { SessionComposer } from "@/components/composer/SessionComposer";
import type { PaneProps } from "../types";
import { SessionMessageList, SessionMessagesSkeleton } from "./transcript/MessageList";

// Cap the transcript text handed to a voice call so context stays cheap to send.
const VOICE_CONTEXT_MAX_CHARS = 1000;

export interface SessionPaneProps extends PaneProps {
  sessionId: string;
  onBack?: () => void;
  /** Active panes own linked panes and artifact shortcuts. Overlays stay
   *  interactive but secondary; passive panes render live read-only state. */
  mode?: "active" | "overlay" | "passive";
}

export function SessionPane({
  sessionId,
  onBack,
  mode = "active",
  variant = "normal",
  actionsSlot,
}: SessionPaneProps) {
  const isPassive = mode === "passive";
  const workspaceSessionStatus = useAtomValue(sessionStatusAtom(sessionId));
  const isDraft = workspaceSessionStatus === "draft" || workspaceSessionStatus === "creating";
  const { defaultModel, setDefaultModel } = useModels();
  // In the "compact" variant (the pager) the session surfaces its location picker
  // + message badges in the host's title bar and hides them from the composer; in
  // "normal" (the grid) it keeps them inline. See PaneProps.
  const isCompact = variant === "compact";
  const { prompt, setPrompt } = useDraftPrompt(sessionId, {
    enabled: !isPassive,
  });

  // ---------------------------------------------------------------------------
  // Session location and creation options
  // ---------------------------------------------------------------------------
  // An untouched draft follows the latest directory; null preserves an explicit clear.
  const [draftDirectorySelection, setDraftDirectorySelection] = useState<string | null>();
  // Subscribe only to this session's durable metadata and worktree.
  const { data: sessionRecord, isLoading: isSessionRecordLoading } = useQuery({
    ...sessionQueries.state(),
    enabled: !isPassive,
    select: (state) => ({
      metadata: state.sessions.find((session) => session.sessionId === sessionId),
      worktree: state.worktrees[sessionId],
      recentDirectory: isDraft ? getRecentDirectories(state.sessions)[0]?.cwd : undefined,
    }),
  });
  const sessionMetadata = sessionRecord?.metadata;
  const sessionContext = sessionMetadata?.context;
  const selectedDirectory = sessionContext?.workingDirectory;
  const selectedRepository = sessionContext?.repository;
  const selectedGitRoot = sessionContext?.gitRoot;
  const draftDirectory =
    draftDirectorySelection === undefined
      ? sessionRecord?.recentDirectory
      : (draftDirectorySelection ?? undefined);
  const effectiveDirectory = isDraft ? draftDirectory : selectedDirectory;

  // Worktree choice is creation-time state local to a draft.
  const [useWorktree, setUseWorktree] = useState(() =>
    isDraft ? getSettings().useWorktree : false,
  );

  // The hook owns reduced session state. The default model and creation options
  // seed a draft's first turn; directory also scopes streamed skills.
  const {
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    model: sessionModel,
    todos,
    linkedSessionIds,
    canvases,
    artifacts,
    hasLoadedSessionState,
    error,
    sendMessage,
    setModel: setSessionModel,
    stop,
    cancelQueuedMessage,
  } = useSession(sessionId, {
    mode: isPassive ? "passive" : "active",
    defaultModel: defaultModel ?? undefined,
    directory: effectiveDirectory,
    useWorktree: workspaceSessionStatus === "draft" ? useWorktree : undefined,
  });

  // Drafts start with the browser default. Existing sessions reveal their
  // model only after hydration; if history has none, the default then becomes
  // the next-message fallback instead of flashing before session state loads.
  const displayedModel = isDraft || hasLoadedSessionState ? (sessionModel ?? defaultModel) : null;

  // Update both this session and the browser-wide default.
  function handleModelChange(nextModel: ModelConfiguration) {
    setSessionModel(nextModel);
    setDefaultModel(nextModel);
  }

  // Skills are directory-scoped — fetch once per CWD, shared across sessions.
  // The stream-based path (session.skills_loaded → useSession cache prime) populates
  // this for live sessions; the query here covers cold sessions via RPC fallback.
  const { data: skills } = useQuery({
    ...skillQueries.list(sessionId, selectedDirectory!),
    enabled: !isDraft && !!selectedDirectory,
  });
  const { publishSessionPanes } = useLinkedPaneActions();

  useEffect(() => {
    if (mode !== "active") return;
    if (!isDraft && !hasLoadedSessionState) return;

    publishSessionPanes(
      sessionId,
      isDraft ? [] : linkedSessionIds,
      isDraft ? [] : (canvases ?? []),
      isDraft ? [] : artifacts,
    );
  }, [
    artifacts,
    canvases,
    hasLoadedSessionState,
    isDraft,
    mode,
    linkedSessionIds,
    sessionId,
    publishSessionPanes,
  ]);

  // ---------------------------------------------------------------------------
  // Render state and handlers
  // ---------------------------------------------------------------------------
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  const worktree = sessionRecord?.worktree;
  const isWorktreeSession = !isDraft && Boolean(worktree?.branch);
  const [isWorktreeBusy, setIsWorktreeBusy] = useState(false);
  async function handleMerge() {
    setIsWorktreeBusy(true);
    try {
      await mergeSessionWorktree({ data: { sessionId } });
    } catch (error) {
      console.error("Failed to merge worktree:", error);
    }
    setIsWorktreeBusy(false);
  }

  async function handleApply() {
    setIsWorktreeBusy(true);
    try {
      await applySessionWorktree({ data: { sessionId } });
    } catch (error) {
      console.error("Failed to apply worktree:", error);
    }
    setIsWorktreeBusy(false);
  }

  // Shared between the desktop composer and compact title bar.
  const isExistingLocationLoading = !isDraft && isSessionRecordLoading;
  const shouldShowLocationPicker =
    isDraft || isExistingLocationLoading || Boolean(selectedDirectory) || isWorktreeSession;
  const locationPickerProps: SessionLocationPickerProps | undefined = shouldShowLocationPicker
    ? {
        value: isDraft ? draftDirectorySelection : selectedDirectory,
        repository: selectedRepository,
        gitRoot: selectedGitRoot,
        isLoading: isExistingLocationLoading,
        onValueChange: isDraft ? setDraftDirectorySelection : undefined,
        useWorktree: isDraft ? useWorktree : undefined,
        onUseWorktreeChange: isDraft ? setUseWorktree : undefined,
        branch: sessionContext?.branch,
        worktreeActions: isWorktreeSession
          ? {
              worktreeBranch: worktree?.branch,
              worktreeBaseBranch: worktree?.baseBranch,
              onMerge: handleMerge,
              onApply: handleApply,
              isWorktreeBusy,
            }
          : undefined,
      }
    : undefined;

  function handleSubmit(text: string, attachments: Attachment[]) {
    void sendMessage(text, attachments);

    // Force scroll to bottom after submitting a message
    scrollToBottomRef.current?.();
  }

  const editDiffs = useEditDiffs(messages, effectiveDirectory);
  const isSessionNotFound = !isDraft && error?.message?.includes("Session not found");

  // The most recent spoken turn, handed to the voice composer so a call opens
  // already aware of what the user is working on. Voice is hidden while the
  // session streams, so derive its context only after the turn completes.
  let lastVoiceMessage: string | undefined;
  if (!isStreaming) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if ((message.role === "user" || message.role === "assistant") && message.content.trim()) {
        lastVoiceMessage = message.content.trim().slice(0, VOICE_CONTEXT_MAX_CHARS);
        break;
      }
    }
  }

  // Show skeleton only on initial load. Draft sessions skip it since they
  // start empty; background refetches update messages in place.
  const isLoadingSessionState = !isDraft && !hasLoadedSessionState;

  return (
    <div className="flex flex-col h-full">
      {/* Compact panes declare location and message count into the host title bar. */}
      {isCompact &&
        actionsSlot &&
        !isPassive &&
        createPortal(
          <div className="flex min-w-0 items-center gap-1.5">
            {locationPickerProps && (
              // Logical padding overrides the picker's padding-inline in the desktop deck.
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
          <SessionCwdProvider value={effectiveDirectory}>
            <EditDiffsProvider value={editDiffs.byToolCallId}>
              <SessionMessageList
                messages={messages}
                isStreaming={isStreaming}
                status={status}
                reasoningContent={reasoningContent}
                scrollToBottomRef={scrollToBottomRef}
              />
            </EditDiffsProvider>
          </SessionCwdProvider>
        )}
      </div>

      {!isPassive && !isSessionNotFound && (
        <div className="px-4 pt-4 md:pb-4 border-t bg-background shrink-0">
          <SessionComposer
            sessionId={sessionId}
            value={prompt}
            onValueChange={setPrompt}
            onSubmit={handleSubmit}
            canSubmit={workspaceSessionStatus !== "creating"}
            isStreaming={isStreaming}
            onStop={stop}
            model={displayedModel}
            onModelChange={handleModelChange}
            locationPicker={isCompact ? undefined : locationPickerProps}
            todos={todos}
            skills={skills}
            sessionDiff={editDiffs}
            artifacts={mode === "active" ? artifacts : []}
            queuedMessages={queuedMessages}
            onCancelQueuedMessage={cancelQueuedMessage}
            sessionName={sessionMetadata?.summary}
            lastMessage={lastVoiceMessage}
          />
        </div>
      )}
    </div>
  );
}
