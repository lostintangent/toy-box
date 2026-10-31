import { normalizeModelConfiguration, type ModelConfiguration } from "@providers/model";
import { useEffect, useRef, useState } from "react";
import { MessagesSquare, MessageSquareText } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import type { UserMessage } from "../model";
import { getRecentDirectories } from "../model/recentDirectories";
import { sessionMutations } from "../mutations";
import { sessionQueries } from "../queries";
import { useSession } from "../useSession";
import { useSessionActivity } from "../useSessionActivity";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "./location/SessionLocationPicker";
import { SessionMetadataBadges } from "./location/SessionMetadataBadges";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { sessionFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { createLinkedPanes, createSessionPane, resolveArtifactSelection } from "../model/panes";
import { useModels } from "@providers/useModels";
import { EditDiffsProvider, useEditDiffs } from "./transcript/editDiffs";
import { SessionComposer } from "./composer/SessionComposer";
import { CurrentSessionProvider, type SessionPaneMode } from "./CurrentSessionContext";
import { PaneActions, type PaneVariant } from "@/shared/panes/PaneSlots";
import { PaneViewMenu } from "@/shared/panes/PaneViewMenu";
import { SessionMessageList } from "./transcript/MessageList";
import type { TranscriptView } from "./transcript/transcriptView";
import { TranscriptSkeleton } from "@/shared/messages/TranscriptSkeleton";

// Cap the transcript text handed to a voice call so context stays cheap to send.
const VOICE_CONTEXT_MAX_CHARS = 1000;

const TRANSCRIPT_VIEWS = [
  { value: "all", label: "All messages", Icon: MessagesSquare },
  { value: "responses", label: "Responses", Icon: MessageSquareText },
] as const;

type SessionPaneProps = {
  sessionId: string;
  variant?: PaneVariant;
  isVisible?: boolean;
  /** Mode defaults to active. Active panes own linked panes and artifact shortcuts. Overlays stay
   *  interactive but secondary; passive panes render live read-only state.
   *  Secondary modes default to compact presentation. */
  mode?: SessionPaneMode;
};

export function SessionPane({
  sessionId,
  mode = "active",
  variant,
  isVisible = true,
}: SessionPaneProps) {
  const { panePublications, focusedPaneAtom } = useWorkspaceSurface();
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>();
  const isPassive = mode === "passive";
  const { waiting } = useSessionActivity(sessionId);
  const defaultUseWorktree = useWorkspaceSelector((workspace) => workspace.settings.useWorktree);
  // In the "compact" variant (the pager) the session surfaces its location picker
  // + message badges in the host's title bar and hides them from the composer; in
  // "normal" (the grid) it keeps them inline. See WorkspacePaneView.
  const isCompact = variant === "compact" || (variant === undefined && mode !== "active");
  const defaultView = useWorkspaceSelector((workspace) => workspace.settings.defaultSessionView);
  const [view, setView] = useState<TranscriptView>(mode === "active" ? defaultView : "all");

  // ---------------------------------------------------------------------------
  // Session location
  // ---------------------------------------------------------------------------
  // An untouched draft follows the latest directory; null preserves an explicit clear.
  const [directorySelection, setDirectorySelection] = useState<string | null | undefined>(
    undefined,
  );
  // Subscribe only to this session's durable metadata and worktree.
  const { data: sessionRecord, isLoading: isSessionRecordLoading } = useQuery({
    ...sessionQueries.state(),
    enabled: !isPassive,
    select: (state) => {
      const session = state.sessions.find((session) => session.id === sessionId);
      return {
        session,
        worktree: state.worktrees[sessionId],
        recentDirectory:
          session && !session.provider && directorySelection === undefined
            ? getRecentDirectories(state.sessions)[0]?.cwd
            : undefined,
      };
    },
  });
  const session = sessionRecord?.session;
  const isDraft = session !== undefined && !session.provider;
  const { models, defaultModel, setDefaultModel } = useModels(session?.provider?.id);
  const selectedDirectory = session?.context?.directory;
  const selectedRepository = session?.context?.repository;
  const selectedGitRoot = session?.context?.gitRoot;
  const initialDirectory =
    directorySelection === undefined
      ? sessionRecord?.recentDirectory
      : (directorySelection ?? undefined);
  const effectiveDirectory = isDraft ? initialDirectory : selectedDirectory;

  // Worktree choice belongs to a draft's initial location.
  const [useWorktree, setUseWorktree] = useState(isDraft ? defaultUseWorktree : false);

  const fallbackModel = normalizeModelConfiguration(models, defaultModel);

  // The hook owns reduced session state. The default model and location seed a
  // draft's first turn; directory also scopes skill discovery.
  const {
    messages,
    queuedMessages,
    isStreaming,
    status,
    reasoningContent,
    model: sessionModel,
    contextUsage,
    todos,
    linkedSessionIds,
    canvases,
    preview,
    artifacts,
    openedFiles,
    hasLoadedSessionState,
    error,
    sendMessage,
    setModel: setSessionModel,
    stop,
  } = useSession(sessionId, {
    mode: isPassive ? "passive" : "active",
    isVisible,
    defaultModel: fallbackModel ?? undefined,
    directory: effectiveDirectory,
    useWorktree: isDraft ? useWorktree : undefined,
    session,
  });

  // Drafts start with the workspace default. Existing sessions reveal their
  // model only after hydration; if history has none, the default then becomes
  // the next-message fallback instead of flashing before session state loads.
  const displayedModel = isDraft || hasLoadedSessionState ? (sessionModel ?? fallbackModel) : null;

  // Update both this session and the workspace-wide default.
  function handleModelChange(nextModel: ModelConfiguration) {
    setSessionModel(nextModel);
    setDefaultModel(nextModel);
  }

  const selectedArtifact = resolveArtifactSelection(
    artifacts,
    selectedArtifactPath,
    session?.artifactPath,
  );
  if (selectedArtifactPath !== selectedArtifact?.path) {
    setSelectedArtifactPath(selectedArtifact?.path);
  }

  useEffect(() => {
    if (mode !== "active") return;
    if (!isDraft && !hasLoadedSessionState) return;
    panePublications.actions.publishLinkedPanes(
      createSessionPane(sessionId).id,
      createLinkedPanes(
        sessionId,
        linkedSessionIds,
        canvases,
        selectedArtifact?.path ? [selectedArtifact.path] : [],
        openedFiles,
        preview,
      ),
    );
  }, [
    selectedArtifact?.path,
    openedFiles,
    canvases,
    preview,
    hasLoadedSessionState,
    isDraft,
    mode,
    panePublications,
    linkedSessionIds,
    sessionId,
  ]);

  function handleOpenArtifact(path: string) {
    setSelectedArtifactPath(path);
    panePublications.actions.publishLinkedPanes(
      createSessionPane(sessionId).id,
      createLinkedPanes(sessionId, linkedSessionIds, canvases, [path], openedFiles, preview),
    );
    focusedPaneAtom.set(createEditorPane(sessionFile(sessionId, path)).id);
  }

  // ---------------------------------------------------------------------------
  // Render state and handlers
  // ---------------------------------------------------------------------------
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  const worktree = sessionRecord?.worktree;
  const isWorktreeSession = !isDraft && Boolean(worktree?.branch);
  const {
    mutate: mergeWorktree,
    isPending: isMergePending,
    error: mergeError,
    submittedAt: mergeSubmittedAt,
  } = useMutation(sessionMutations.mergeWorktree(sessionId));
  const {
    mutate: applyWorktree,
    isPending: isApplyPending,
    error: applyError,
    submittedAt: applySubmittedAt,
  } = useMutation(sessionMutations.applyWorktree(sessionId));
  const isWorktreeMutationPending = isMergePending || isApplyPending;
  const worktreeError = mergeSubmittedAt > applySubmittedAt ? mergeError : applyError;

  // Shared between the desktop composer and compact title bar.
  const isExistingLocationLoading = !isDraft && isSessionRecordLoading;
  const shouldShowLocationPicker =
    isDraft || isExistingLocationLoading || Boolean(selectedDirectory) || isWorktreeSession;
  const locationPickerProps: SessionLocationPickerProps | undefined = shouldShowLocationPicker
    ? {
        value: isDraft ? directorySelection : selectedDirectory,
        repository: selectedRepository,
        gitRoot: selectedGitRoot,
        isLoading: isExistingLocationLoading,
        onValueChange: isDraft ? setDirectorySelection : undefined,
        useWorktree: isDraft ? useWorktree : undefined,
        onUseWorktreeChange: isDraft ? setUseWorktree : undefined,
        branch: session?.context?.branch,
        worktreeActions: isWorktreeSession
          ? {
              worktreeBranch: worktree?.branch,
              worktreeBaseBranch: worktree?.baseBranch,
              onMerge: () => mergeWorktree(),
              onApply: () => applyWorktree(),
              isPending: isWorktreeMutationPending,
            }
          : undefined,
      }
    : undefined;

  function handleSubmit(
    message: Pick<UserMessage, "content" | "attachments">,
    options?: { immediate?: true },
  ) {
    void sendMessage(message, options);

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
      {mode === "active" && (
        <PaneActions>
          {isCompact && (
            <div className="flex min-w-0 items-center gap-1.5">
              {locationPickerProps && (
                // Logical padding overrides the picker's padding-inline in the desktop deck.
                <SessionLocationPicker {...locationPickerProps} className="md:pe-0" />
              )}
              <SessionMetadataBadges messageCount={messages.length} />
            </div>
          )}
          <PaneViewMenu view={view} views={TRANSCRIPT_VIEWS} onViewChange={setView} />
        </PaneActions>
      )}

      <div className="flex-1 overflow-hidden">
        {isSessionNotFound ? (
          <div className="h-full flex flex-col items-center justify-center bg-panel p-4 text-center">
            <p className="text-muted-foreground mb-2">Session not found</p>
            <p className="text-sm text-muted-foreground/70">
              This session may have been deleted or is no longer available.
            </p>
          </div>
        ) : isLoadingSessionState ? (
          <TranscriptSkeleton />
        ) : (
          <CurrentSessionProvider
            value={{
              sessionId,
              cwd: effectiveDirectory,
              mode,
              artifacts,
              onOpenArtifact: mode === "active" ? handleOpenArtifact : undefined,
            }}
          >
            <EditDiffsProvider value={editDiffs.byToolCallId}>
              <SessionMessageList
                messages={messages}
                view={view}
                isStreaming={isStreaming}
                isWaiting={waiting}
                status={status}
                reasoningContent={reasoningContent}
                scrollToBottomRef={scrollToBottomRef}
              />
            </EditDiffsProvider>
          </CurrentSessionProvider>
        )}
      </div>

      {!isPassive && !isSessionNotFound && (
        <div className="shrink-0 border-t bg-background px-4 pt-4 md:pb-4">
          {isWorktreeSession && worktreeError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {worktreeError.message}
            </p>
          )}
          <SessionComposer
            sessionId={sessionId}
            onSubmit={handleSubmit}
            models={models}
            isStreaming={isStreaming}
            isBusy={isStreaming && status !== "background"}
            onStop={stop}
            model={displayedModel}
            onModelChange={handleModelChange}
            locationPicker={isCompact ? undefined : locationPickerProps}
            todos={todos}
            sessionDiff={editDiffs}
            artifacts={mode === "active" ? artifacts : []}
            onOpenArtifact={mode === "active" ? handleOpenArtifact : undefined}
            preview={preview}
            directory={effectiveDirectory}
            queuedMessages={queuedMessages}
            sessionName={session?.title}
            lastMessage={lastVoiceMessage}
            contextUsage={contextUsage}
          />
        </div>
      )}
    </div>
  );
}
