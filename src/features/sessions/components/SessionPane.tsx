import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import type { ModelConfiguration } from "../model/modelConfiguration";
import type { Attachment } from "../model";
import { getRecentDirectories } from "../model/recentDirectories";
import { sessionMutations } from "../mutations";
import { sessionQueries, skillQueries } from "../queries";
import { useSession } from "../useSession";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "./location/SessionLocationPicker";
import { SessionMetadataBadges } from "./location/SessionMetadataBadges";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useModels } from "../useModels";
import { EditDiffsProvider, useEditDiffs } from "./transcript/editDiffs";
import { SessionComposer } from "./composer/SessionComposer";
import { CurrentSessionProvider, type SessionPaneMode } from "./CurrentSessionContext";
import { Skeleton } from "@/shared/components/ui/skeleton";
import type { PaneVariant } from "@workspace/components/panes/WorkspacePaneView";
import { PaneActions } from "@workspace/components/panes/shell/PaneSlots";

const SessionMessageList = lazy(() =>
  import("./transcript/MessageList").then((module) => ({
    default: module.SessionMessageList,
  })),
);

// Cap the transcript text handed to a voice call so context stays cheap to send.
const VOICE_CONTEXT_MAX_CHARS = 1000;

type SessionPaneProps = {
  sessionId: string;
  variant?: PaneVariant;
  /** Mode defaults to active. Active panes own linked panes and artifact shortcuts. Overlays stay
   *  interactive but secondary; passive panes render live read-only state.
   *  Secondary modes default to compact presentation. */
  mode?: SessionPaneMode;
};

export function SessionPane({ sessionId, mode = "active", variant }: SessionPaneProps) {
  const { panePublications } = useWorkspaceSurface();
  const isPassive = mode === "passive";
  const workspaceSessionStatus = useWorkspaceSelector(
    (workspace) => workspace.sessionStates[sessionId]?.status ?? "idle",
  );
  const draftArtifactPath = useWorkspaceSelector((workspace) => {
    const session = workspace.sessionStates[sessionId];
    return session?.status === "draft" ? session.artifactPath : undefined;
  });
  const defaultUseWorktree = useWorkspaceSelector((workspace) => workspace.settings.useWorktree);
  const isHyper = useWorkspaceSelector((workspace) =>
    workspace.hyperSessionIds.includes(sessionId),
  );
  const isDraft = workspaceSessionStatus === "draft";
  const { models, defaultModel, setDefaultModel } = useModels();
  // In the "compact" variant (the pager) the session surfaces its location picker
  // + message badges in the host's title bar and hides them from the composer; in
  // "normal" (the grid) it keeps them inline. See WorkspacePaneView.
  const isCompact = variant === "compact" || (variant === undefined && mode !== "active");

  // ---------------------------------------------------------------------------
  // Session location
  // ---------------------------------------------------------------------------
  // An untouched draft follows the latest directory; null preserves an explicit clear.
  const [draftDirectorySelection, setDraftDirectorySelection] = useState<string | null | undefined>(
    undefined,
  );
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

  // Worktree choice belongs to a draft's initial location.
  const [useWorktree, setUseWorktree] = useState(isDraft ? defaultUseWorktree : false);

  // The hook owns reduced session state. The default model and location seed a
  // draft's first turn; directory also scopes skill discovery.
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
    openedFiles,
    hasLoadedSessionState,
    error,
    sendMessage,
    setModel: setSessionModel,
    stop,
  } = useSession(sessionId, {
    workspaceSessionStatus,
    mode: isPassive ? "passive" : "active",
    defaultModel: defaultModel ?? undefined,
    directory: effectiveDirectory,
    useWorktree: isDraft ? useWorktree : undefined,
    draftArtifactPath,
  });

  // Drafts start with the workspace default. Existing sessions reveal their
  // model only after hydration; if history has none, the default then becomes
  // the next-message fallback instead of flashing before session state loads.
  const displayedModel = isDraft || hasLoadedSessionState ? (sessionModel ?? defaultModel) : null;

  // Update both this session and the workspace-wide default.
  function handleModelChange(nextModel: ModelConfiguration) {
    setSessionModel(nextModel);
    setDefaultModel(nextModel);
  }

  // Skills follow the effective directory, with no directory resolving host-level skills.
  const { data: skills } = useQuery({
    ...skillQueries.list(effectiveDirectory, isHyper ? "hyper" : undefined),
    enabled: !isPassive && !isSessionRecordLoading,
  });
  useEffect(() => {
    if (mode !== "active") return;
    if (!isDraft && !hasLoadedSessionState) return;

    panePublications.actions.publishSessionPanes(
      sessionId,
      isDraft ? [] : linkedSessionIds,
      isDraft ? [] : (canvases ?? []),
      artifacts,
      isDraft ? [] : openedFiles,
    );
  }, [
    artifacts,
    openedFiles,
    canvases,
    hasLoadedSessionState,
    isDraft,
    mode,
    panePublications,
    linkedSessionIds,
    sessionId,
  ]);

  // ---------------------------------------------------------------------------
  // Render state and handlers
  // ---------------------------------------------------------------------------
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  const worktree = sessionRecord?.worktree;
  const isWorktreeSession = !isDraft && Boolean(worktree?.branch);
  const mergeWorktreeMutation = useMutation(sessionMutations.mergeWorktree(sessionId));
  const applyWorktreeMutation = useMutation(sessionMutations.applyWorktree(sessionId));
  const isWorktreeMutationPending =
    mergeWorktreeMutation.isPending || applyWorktreeMutation.isPending;

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
              onMerge: () => mergeWorktreeMutation.mutate(),
              onApply: () => applyWorktreeMutation.mutate(),
              isPending: isWorktreeMutationPending,
            }
          : undefined,
      }
    : undefined;

  function handleSubmit(text: string, attachments: Attachment[], immediate?: true) {
    void sendMessage(text, attachments, immediate);

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
      {isCompact && mode === "active" && (
        <PaneActions>
          <div className="flex min-w-0 items-center gap-1.5">
            {locationPickerProps && (
              // Logical padding overrides the picker's padding-inline in the desktop deck.
              <SessionLocationPicker {...locationPickerProps} className="md:pe-0" />
            )}
            <SessionMetadataBadges messageCount={messages.length} />
          </div>
        </PaneActions>
      )}

      <div className="flex-1 overflow-hidden">
        {isSessionNotFound ? (
          <div className="h-full flex flex-col items-center justify-center bg-muted/50 p-4 text-center">
            <p className="text-muted-foreground mb-2">Session not found</p>
            <p className="text-sm text-muted-foreground/70">
              This session may have been deleted or is no longer available.
            </p>
          </div>
        ) : isLoadingSessionState ? (
          <SessionMessagesSkeleton />
        ) : (
          <Suspense fallback={<SessionMessagesSkeleton />}>
            <CurrentSessionProvider value={{ sessionId, cwd: effectiveDirectory, mode }}>
              <EditDiffsProvider value={editDiffs.byToolCallId}>
                <SessionMessageList
                  messages={messages}
                  isStreaming={isStreaming}
                  status={status}
                  reasoningContent={reasoningContent}
                  scrollToBottomRef={scrollToBottomRef}
                />
              </EditDiffsProvider>
            </CurrentSessionProvider>
          </Suspense>
        )}
      </div>

      {!isPassive && !isSessionNotFound && (
        <div className="px-4 pt-4 md:pb-4 border-t bg-background shrink-0">
          <SessionComposer
            sessionId={sessionId}
            onSubmit={handleSubmit}
            models={models}
            isStreaming={isStreaming}
            onStop={stop}
            model={displayedModel}
            onModelChange={handleModelChange}
            locationPicker={isCompact ? undefined : locationPickerProps}
            todos={todos}
            skills={skills}
            showGlobalSkillBadges={Boolean(effectiveDirectory)}
            sessionDiff={editDiffs}
            artifacts={mode === "active" ? artifacts : []}
            queuedMessages={queuedMessages}
            sessionName={sessionMetadata?.summary}
            lastMessage={lastVoiceMessage}
          />
        </div>
      )}
    </div>
  );
}

function SessionMessagesSkeleton() {
  return (
    <div className="h-full space-y-4 p-4 bg-muted/50">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-52 rounded-lg" />
      </div>
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
