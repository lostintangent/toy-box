import { useHotkey } from "@tanstack/react-hotkeys";
import { createFileRoute, useNavigate, ClientOnly } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useDeferredValue,
  lazy,
  Suspense,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { PanelLeft } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { deleteSession, renameSession } from "@/functions/sessions";
import { getRuntimeConfig } from "@/functions/config";
import { modelQueries, workspaceQueries } from "@/lib/queries";
import { useAutomations } from "@/hooks/automations/useAutomations";
import { useLocalStorage } from "@/hooks/browser/useLocalStorage";
import { useDrafts } from "@/hooks/session/useDrafts";
import { useHyperSessions } from "@/hooks/session/useHyperSessions";
import { useModelConfiguration } from "@/hooks/session/useModelConfiguration";
import { useSessions } from "@/hooks/session/useSessions";
import { useWorkspace } from "@/hooks/workspace/useWorkspace";
import { WorkspaceProvider } from "@/hooks/workspace/context";
import { useViewport } from "@/hooks/browser/ViewportContext";
import { usePanelTransition } from "@/hooks/browser/usePanelTransition";
import { Sidebar, SidebarProps } from "@/components/sidebar/Sidebar";
import { RenameDialog } from "@/components/config/sessions/RenameDialog";
import { SessionGrid } from "@/components/workspace/layout/SessionGrid";
import { HyperSession } from "@/components/workspace/layout/HyperSession";
import { SessionPager } from "@/components/workspace/layout/SessionPager";
import { WorkspacePlaceholder } from "@/components/workspace/layout/WorkspacePlaceholder";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import { useLinkedPanes } from "@/hooks/session/useLinkedPanes";
import { useWorkspaceFocus } from "@/hooks/workspace/useWorkspaceFocus";
import type { HyperSessionState } from "@/hooks/session/useHyperSessions";
import {
  deriveOpenSessionIds,
  deriveReachableSessionIds,
  deriveVisibleWorkspacePanes,
  type WorkspacePane,
} from "@/lib/workspace/panes";
import {
  normalizeSessionDirectoryOptions,
  type SessionDirectoryOption,
} from "@/components/workspace/panes/session/location/directory/directoryOptions";
import { parseLayoutPrefs, resolveLayoutPrefs } from "@/lib/config/layoutPrefs";
import { useLayoutCookie } from "@/hooks/browser/useLayoutCookie";
import {
  cancelSessionsState,
  getSessionsStateSnapshot,
  removeSessionFromState,
  replaceSessionsState,
  upsertSessionInState,
} from "@/lib/session/queryCache";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
const Terminal = lazy(() =>
  import("@/components/terminal/Terminal").then((m) => ({ default: m.Terminal })),
);

const SESSIONS_SHOW_CHILD_KEY = "sessions:show-child";
const SESSIONS_SHOW_EXTERNAL_KEY = "sessions:show-external";

const searchSchema = z.object({
  sessionIds: z.array(z.string()).max(4).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(searchSchema),
  loader: async ({ context }) => {
    const [layoutPrefs] = await Promise.all([
      loadLayoutPrefs(),
      context.queryClient.ensureQueryData(workspaceQueries.state()),
    ]);
    return layoutPrefs;
  },
  component: SessionsPage,
});

const EMPTY_SESSION_IDS: string[] = [];

function parseStoredBoolean(value: string): boolean {
  return value === "true";
}

const readLayoutCookieHeader = createIsomorphicFn()
  .client(() => document.cookie)
  .server(async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("cookie") ?? getRequestHeader("Cookie");
  });

async function loadLayoutPrefs() {
  const runtimeConfig = await getRuntimeConfig();
  const cookieHeader = await readLayoutCookieHeader();

  return {
    ...resolveLayoutPrefs(parseLayoutPrefs(cookieHeader)),
    terminalWsPort: runtimeConfig.terminalWsPort,
  };
}

type HyperLayoutState = Pick<HyperSessionState, "open" | "position">;

function restoreHyperSessionState(
  sessionId: string | undefined,
  layout: HyperLayoutState,
): HyperSessionState | null {
  return sessionId ? { sessionId, ...layout } : null;
}

function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const selectedSessionIds = search?.sessionIds ?? EMPTY_SESSION_IDS;
  const {
    sidebarSize: initialSidebarSize,
    terminalSize: initialTerminalSize,
    sidebarOpen: initialSidebarOpen,
    terminalOpen: initialTerminalOpen,
    automationsExpanded: initialAutomationsExpanded,
    hyperOpen: initialHyperOpen,
    hyperPosition: initialHyperPosition,
    terminalWsPort,
  } = Route.useLoaderData();
  const { isMobile: isMobileLayout, hydrated } = useViewport();

  const updateSelectedSessionIds = useCallback(
    (nextSelectedSessionIds: string[], options?: { replace?: boolean }) => {
      navigate({
        to: "/",
        search: nextSelectedSessionIds.length > 0 ? { sessionIds: nextSelectedSessionIds } : {},
        replace: options?.replace,
      });
    },
    [navigate],
  );

  const primarySelectedSessionId = selectedSessionIds[0];
  const { linkedPanesBySource, setArtifactPaneMode, prunePaneSources } = useLinkedPanes();
  const reachableSessionIds = useMemo(
    () => deriveReachableSessionIds(selectedSessionIds, linkedPanesBySource),
    [linkedPanesBySource, selectedSessionIds],
  );
  const openPanes = useMemo(
    () =>
      deriveVisibleWorkspacePanes({
        selectedSessionIds,
        linkedPanesBySource,
      }),
    [linkedPanesBySource, selectedSessionIds],
  );
  const openSessionIds = useMemo(() => deriveOpenSessionIds(openPanes), [openPanes]);

  useWorkspaceFocus(openPanes);

  const { data: models = [] } = useQuery(modelQueries.list());

  const [selectedModelConfiguration, handleModelConfigurationChange] =
    useModelConfiguration(models);
  const [showChildSessions, setShowChildSessions] = useLocalStorage(
    SESSIONS_SHOW_CHILD_KEY,
    false,
    parseStoredBoolean,
  );
  const [showExternalSessions, setShowExternalSessions] = useLocalStorage(
    SESSIONS_SHOW_EXTERNAL_KEY,
    true,
    parseStoredBoolean,
  );

  const [sidebarSize, setSidebarSize] = useState(initialSidebarSize);
  const [terminalSize, setTerminalSize] = useState(initialTerminalSize);
  const [isSidebarOpen, setIsSidebarOpen] = useState(initialSidebarOpen);

  // Terminal state - synced with cookie (SSR-safe)
  const [isTerminalOpen, setIsTerminalOpen] = useState(initialTerminalOpen);
  const [isAutomationsExpanded, setIsAutomationsExpanded] = useState(initialAutomationsExpanded);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const shouldRenderMobileTerminalShell = import.meta.env.SSR
    ? initialTerminalOpen
    : isTerminalOpen;

  const {
    allSessions,
    sessions,
    isLoading: isSessionsLoading,
    worktreeSessionIds,
    childSessionIds,
  } = useSessions();
  const workspace = useWorkspace({
    openSessionIds,
  });
  const isLoading = isSessionsLoading || workspace.isLoading;
  const hyperSessionIds = workspace.hyperSessionIds;
  const streamingSessionIds = workspace.runningSessionIds;
  const unreadSessionIds = workspace.unreadSessionIds;

  const hyperSessionIdSet = useMemo(() => new Set(hyperSessionIds), [hyperSessionIds]);
  const { listedDrafts, isDraft, createDraft, discardDraft } = useDrafts({
    sessions: allSessions,
    drafts: workspace.drafts,
    hyperSessionIds,
    draftPromptsBySessionId: workspace.draftPromptsBySessionId,
    dispatchWorkspaceAction: workspace.dispatchWorkspaceAction,
  });

  const {
    automations,
    isLoading: isAutomationsLoading,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    runAutomation,
    isCreatingAutomation,
    updatingAutomationId,
    deletingAutomationId,
    runningAutomationIds,
  } = useAutomations({
    onUserRunRequested: (sessionId) => {
      updateSelectedSessionIds([sessionId]);
    },
    streamingSessionIds,
  });
  const availableSessionIds = useMemo(() => {
    const ids = new Set(allSessions.map((session) => session.sessionId));
    for (const draft of workspace.drafts) {
      ids.add(draft.sessionId);
    }
    for (const automation of automations) {
      if (!automation.lastRunSessionId) continue;
      ids.add(automation.lastRunSessionId);
    }
    return ids;
  }, [allSessions, automations, workspace.drafts]);
  const handleCloseVisibleSession = useCallback(
    (sessionId: string) => {
      if (!selectedSessionIds.includes(sessionId)) {
        return;
      }

      updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionId));
    },
    [selectedSessionIds, updateSelectedSessionIds],
  );

  const handleCloseVisiblePane = useCallback(
    (pane: WorkspacePane) => {
      if (pane.kind !== "session" || pane.isLinkedOnly) return;
      handleCloseVisibleSession(pane.sessionId);
    },
    [handleCloseVisibleSession],
  );

  const handleSessionSelect = useCallback(
    (sessionId: string | null, modifierKey: boolean = false) => {
      if (sessionId === null) {
        updateSelectedSessionIds([]);
        return;
      }

      if (!modifierKey || isMobileLayout) {
        updateSelectedSessionIds([sessionId]);
        return;
      }

      if (selectedSessionIds.includes(sessionId)) {
        handleCloseVisibleSession(sessionId);
        return;
      }

      if (openPanes.length >= 4 && !openSessionIds.includes(sessionId)) {
        return;
      }

      updateSelectedSessionIds([...selectedSessionIds, sessionId]);
    },
    [
      handleCloseVisibleSession,
      isMobileLayout,
      openSessionIds,
      openPanes.length,
      selectedSessionIds,
      updateSelectedSessionIds,
    ],
  );

  // Create a new draft session (client-side only until first message).
  // With modifier key (Cmd/Ctrl), adds to the workspace instead of replacing.
  const handleCreateSession = useCallback(
    (e?: React.MouseEvent) => {
      const id = createDraft();

      const hasModifier = e?.metaKey || e?.ctrlKey;
      if (hasModifier && openSessionIds.length > 0 && openSessionIds.length < 4) {
        // Add to the workspace.
        updateSelectedSessionIds([...selectedSessionIds, id]);
      } else {
        // Replace current view
        updateSelectedSessionIds([id]);
      }
    },
    [createDraft, openSessionIds.length, selectedSessionIds, updateSelectedSessionIds],
  );

  // Keep URL session IDs aligned with available sessions.
  // This prevents stale open panes when another client deletes a session.
  useEffect(() => {
    if (isLoading) return;
    if (selectedSessionIds.length === 0) return;

    const validSessionIds = selectedSessionIds.filter((sessionId) =>
      availableSessionIds.has(sessionId),
    );

    if (validSessionIds.length === selectedSessionIds.length) return;

    updateSelectedSessionIds(validSessionIds, { replace: true });
  }, [availableSessionIds, isLoading, selectedSessionIds, updateSelectedSessionIds]);

  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [isTerminalDragging, setIsTerminalDragging] = useState(false);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const sidebarSizeRef = useRef(sidebarSize);
  const terminalSizeRef = useRef(terminalSize);
  const isSidebarDraggingRef = useRef(false);
  const isTerminalDraggingRef = useRef(false);

  // Keep terminal mounted during close animation for smooth transition.
  const [isTerminalMounted, setIsTerminalMounted] = useState(isTerminalOpen);
  const isTerminalAnimating = usePanelTransition("terminal", isTerminalOpen);
  useEffect(() => {
    if (isTerminalOpen) {
      setIsTerminalMounted(true);
    } else if (!isTerminalAnimating) {
      setIsTerminalMounted(false);
    }
  }, [isTerminalOpen, isTerminalAnimating]);

  // Animate terminal panel open/close (mirrors SessionGrid's useEffect pattern)
  useEffect(() => {
    const panel = terminalPanelRef.current;
    if (!panel) return;
    if (isTerminalOpen) {
      if (!Number.isFinite(terminalSize)) return;
      panel.resize(terminalSize);
    } else {
      panel.resize(0);
    }
  }, [isTerminalOpen, terminalSize]);

  useEffect(() => {
    sidebarSizeRef.current = sidebarSize;
  }, [sidebarSize]);

  useEffect(() => {
    terminalSizeRef.current = terminalSize;
  }, [terminalSize]);

  useLayoutCookie("sidebarOpen", isSidebarOpen);
  useLayoutCookie("sidebarSize", sidebarSize);
  useLayoutCookie("terminalOpen", isTerminalOpen);
  useLayoutCookie("terminalSize", terminalSize);
  useLayoutCookie("automationsExpanded", isAutomationsExpanded);

  const handleSidebarResize = useCallback(
    (size: number) => {
      if (size > 0) {
        sidebarSizeRef.current = size;
        if (!isSidebarDraggingRef.current) {
          setSidebarSize(size);
        }
      }
    },
    [setSidebarSize],
  );

  const handleTerminalResize = useCallback(
    (size: number) => {
      if (size > 0) {
        terminalSizeRef.current = size;
        if (!isTerminalDraggingRef.current) {
          setTerminalSize(size);
        }
      }
    },
    [setTerminalSize],
  );

  const handleSidebarDragging = useCallback(
    (dragging: boolean) => {
      isSidebarDraggingRef.current = dragging;
      setIsSidebarDragging(dragging);
      if (!dragging) {
        setSidebarSize(sidebarSizeRef.current);
      }
    },
    [setSidebarSize],
  );

  const handleTerminalDragging = useCallback(
    (dragging: boolean) => {
      isTerminalDraggingRef.current = dragging;
      setIsTerminalDragging(dragging);
      if (!dragging) {
        setTerminalSize(terminalSizeRef.current);
      }
    },
    [setTerminalSize],
  );

  // Pause PTY resize during sidebar open/close animation
  const isSidebarAnimating = usePanelTransition("sidebar", isSidebarOpen);

  const isCollapsed = !isSidebarOpen;

  // Delay showing expand button until collapse animation completes
  const [showExpandButton, setShowExpandButton] = useState(isCollapsed);
  useEffect(() => {
    if (isCollapsed) {
      const timer = setTimeout(() => setShowExpandButton(true), 150);
      return () => clearTimeout(timer);
    } else {
      setShowExpandButton(false);
    }
  }, [isCollapsed]);

  const toggleSidebar = () => {
    const panel = sidebarPanelRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        if (Number.isFinite(sidebarSize)) {
          panel.resize(sidebarSize);
        } else {
          panel.expand();
        }
        setIsSidebarOpen(true);
      } else {
        panel.collapse();
        setIsSidebarOpen(false);
      }
    }
  };

  const toggleTerminal = useCallback(() => {
    setIsTerminalOpen((prev) => !prev);
  }, []);

  // Global keyboard shortcuts
  useHotkey("Mod+B", toggleSidebar);
  useHotkey({ key: "N", ctrl: true }, () => handleCreateSession());
  useHotkey({ key: "`", ctrl: true }, toggleTerminal);

  const handleTerminalClose = useCallback(() => {
    if (typeof window !== "undefined") {
      void import("@/lib/terminal/terminalManager").then(({ terminalManager }) => {
        terminalManager.close();
      });
    }
    setIsTerminalOpen(false);
  }, []);

  const handleTerminalQuickKey = useCallback((data: string) => {
    if (typeof window === "undefined") return;
    void import("@/lib/terminal/terminalManager").then(({ terminalManager }) => {
      terminalManager.sendInput(data);
    });
  }, []);

  const deferredFilter = useDeferredValue(filter);

  // Hide reusable automation sessions from the main session list, then apply source/text filters.
  const filteredSessions = useMemo(() => {
    const hiddenReusableAutomationSessionIds = new Set<string>();
    for (const automation of automations) {
      if (!automation.reuseSession || !automation.lastRunSessionId) continue;
      hiddenReusableAutomationSessionIds.add(automation.lastRunSessionId);
    }

    let result = sessions.filter(
      (session) =>
        !hiddenReusableAutomationSessionIds.has(session.sessionId) &&
        !hyperSessionIdSet.has(session.sessionId),
    );

    if (!showChildSessions) {
      const childSessionIdSet = new Set(childSessionIds);
      result = result.filter((session) => !childSessionIdSet.has(session.sessionId));
    }

    if (!showExternalSessions) {
      result = result.filter((session) => session.sessionId.startsWith(SESSION_ID_PREFIX));
    }

    // Finally apply the text filter on summary.
    const lowerFilter = deferredFilter.trim().toLowerCase();
    if (!lowerFilter) return result;

    return result.filter((session) => session.summary?.toLowerCase().includes(lowerFilter));
  }, [
    sessions,
    automations,
    hyperSessionIdSet,
    showChildSessions,
    childSessionIds,
    showExternalSessions,
    deferredFilter,
  ]);

  const directoryOptions = useMemo<SessionDirectoryOption[]>(() => {
    const rawOptions = sessions.reduce<SessionDirectoryOption[]>((acc, session) => {
      const cwd = session.context?.workingDirectory?.trim();
      if (!cwd) return acc;

      acc.push({
        cwd,
        repository: session.context?.repository,
        gitRoot: session.context?.gitRoot,
      });
      return acc;
    }, []);

    return normalizeSessionDirectoryOptions(rawOptions);
  }, [sessions]);

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession({ data: { sessionId } }),
    onMutate: async (sessionId) => {
      setDeletingSessionId(sessionId);

      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await cancelSessionsState(queryClient);

      // Snapshot the previous value for rollback
      const previousSessionsState = getSessionsStateSnapshot(queryClient);

      // Optimistically remove from cache
      removeSessionFromState(queryClient, sessionId);

      // Return context with the snapshot for rollback
      return { previousSessionsState };
    },
    onError: (_err, _sessionId, context) => {
      // Rollback to the previous value on error
      if (context?.previousSessionsState) {
        replaceSessionsState(queryClient, context.previousSessionsState);
      }
    },
    onSettled: () => {
      setDeletingSessionId(null);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) =>
      renameSession({ data: { sessionId, name } }),
    onMutate: async ({ sessionId, name }) => {
      setRenamingSessionId(sessionId);
      await cancelSessionsState(queryClient);

      const previousSessionsState = getSessionsStateSnapshot(queryClient);
      upsertSessionInState(queryClient, {
        sessionId,
        summary: name,
      });

      return { previousSessionsState };
    },
    onError: (_err, _input, context) => {
      if (context?.previousSessionsState) {
        replaceSessionsState(queryClient, context.previousSessionsState);
      }
    },
    onSettled: () => {
      setRenamingSessionId(null);
    },
  });

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (isDraft(sessionIdToDelete)) {
        discardDraft(sessionIdToDelete);
      } else {
        deleteMutation.mutate(sessionIdToDelete);
      }

      if (selectedSessionIds.includes(sessionIdToDelete)) {
        updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionIdToDelete));
      }
    },
    [deleteMutation, discardDraft, isDraft, selectedSessionIds, updateSelectedSessionIds],
  );

  const renameTargetSession = useMemo(
    () => allSessions.find((session) => session.sessionId === renameTargetId) ?? null,
    [allSessions, renameTargetId],
  );

  const handleSessionRename = useCallback((sessionId: string) => {
    setRenameTargetId(sessionId);
  }, []);

  const handleRenameDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameTargetId(null);
    }
  }, []);

  const handlePromotedHyperSession = useCallback(
    (sessionId: string) => {
      if (!selectedSessionIds.includes(sessionId)) {
        const nextSelectedSessionIds =
          openPanes.length >= 4 && !openSessionIds.includes(sessionId)
            ? [sessionId]
            : [...selectedSessionIds, sessionId];
        updateSelectedSessionIds(nextSelectedSessionIds);
      }
    },
    [openPanes.length, openSessionIds, selectedSessionIds, updateSelectedSessionIds],
  );

  const hyperSessionId = hyperSessionIds[0];
  const restoredHyperSession = useMemo(
    () =>
      restoreHyperSessionState(hyperSessionId, {
        position: initialHyperPosition,
        open: initialHyperOpen,
      }),
    [hyperSessionId, initialHyperOpen, initialHyperPosition],
  );

  const hyperSessions = useHyperSessions({
    hyperSessionIds,
    initialState: restoredHyperSession,
    createDraft,
    dispatchWorkspaceAction: workspace.dispatchWorkspaceAction,
    onDeleteSession: handleSessionDelete,
    onPromotedSession: handlePromotedHyperSession,
  });
  const hyperSession = hyperSessions.state;

  useLayoutCookie("hyperOpen", hyperSessions.isOpen);
  useLayoutCookie("hyperPosition", hyperSession?.position);

  // The hyper session has no floating deck on mobile; opening it there means
  // selecting it into the main view — the same URL navigation any list session
  // uses — so a reload restores it through the existing selected-session SSR.
  const toggleHyper = useCallback(() => {
    if (!isMobileLayout) {
      hyperSessions.toggle();
      return;
    }
    updateSelectedSessionIds([hyperSessions.getOrCreateSessionId()]);
  }, [isMobileLayout, hyperSessions, updateSelectedSessionIds]);

  // "Open" is viewport-relative: the deck is open on desktop; on mobile the hyper
  // session is open when it's the one in view. The sidebar dot is its inverse.
  const isHyperOpen = isMobileLayout
    ? hyperSessionId !== undefined && primarySelectedSessionId === hyperSessionId
    : hyperSessions.isOpen;

  // The hyper deck publishes its linked panes under its own source id, which the
  // "selected" reachable set doesn't include — union it in so those panes survive
  // pruning. deriveReachableSessionIds also follows any linked sub-sessions.
  const hyperReachableSessionIds = useMemo(
    () =>
      hyperSession ? deriveReachableSessionIds([hyperSession.sessionId], linkedPanesBySource) : [],
    [hyperSession, linkedPanesBySource],
  );

  useEffect(() => {
    prunePaneSources(new Set([...reachableSessionIds, ...hyperReachableSessionIds]));
  }, [prunePaneSources, reachableSessionIds, hyperReachableSessionIds]);

  const hasSelectedSession = selectedSessionIds.length > 0;

  // Mobile view state: 'sidebar' | 'session' | 'terminal'
  type MobileView = "sidebar" | "session" | "terminal";
  const baseMobileView: Exclude<MobileView, "terminal"> = hasSelectedSession
    ? "session"
    : "sidebar";
  const mobileView: MobileView = isTerminalOpen ? "terminal" : baseMobileView;
  const mobileTrackIndex = baseMobileView === "sidebar" ? 0 : 1;
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mobileContainerRef.current) {
      mobileContainerRef.current.scrollLeft = 0;
    }
  }, [baseMobileView]);

  const terminalBodySkeleton = (
    <div className="relative flex-1 min-h-0 p-2 pb-0">
      <div className="h-5 w-72 max-w-full rounded-md bg-foreground/5 animate-pulse" />
    </div>
  );

  // Suppress PTY resize during any panel drag or animated open/close
  const isPanelTransitioning =
    isSidebarDragging || isTerminalDragging || isSidebarAnimating || isTerminalAnimating;

  const terminalBody = (
    <ClientOnly fallback={terminalBodySkeleton}>
      <Suspense fallback={terminalBodySkeleton}>
        <Terminal
          onClose={handleTerminalClose}
          isResizing={isPanelTransitioning}
          wsPort={terminalWsPort}
        />
      </Suspense>
    </ClientOnly>
  );

  // Shared sidebar props for both mobile and desktop
  const sidebarProps = {
    filter,
    onFilterChange: setFilter,
    showChildSessions,
    onShowChildSessionsChange: setShowChildSessions,
    showExternalSessions,
    onShowExternalSessionsChange: setShowExternalSessions,
    sessions: filteredSessions,
    isLoading,
    onSessionSelect: handleSessionSelect,
    onSessionRename: handleSessionRename,
    onSessionDelete: handleSessionDelete,
    deletingSessionId,
    activeSessionIds: openSessionIds,
    streamingSessionIds,
    unreadSessionIds,
    worktreeSessionIds,
    emptyMessage: deferredFilter ? "No sessions match your filter" : undefined,
    draftSessions: listedDrafts,
    directoryOptions,
    automations,
    isAutomationsLoading,
    models,
    defaultAutomationModelConfiguration: selectedModelConfiguration ?? undefined,
    isAutomationsExpanded,
    onAutomationsExpandedChange: setIsAutomationsExpanded,
    onCreateAutomation: createAutomation,
    onUpdateAutomation: updateAutomation,
    onDeleteAutomation: async (automationId: string) => {
      await deleteAutomation(automationId);
    },
    onRunAutomation: runAutomation,
    creatingAutomation: isCreatingAutomation,
    updatingAutomationId,
    deletingAutomationId,
    runningAutomationIds,
    onCreateSession: handleCreateSession,
    onToggleHyper: toggleHyper,
    isHyperOpen,
    hasHyperSessions: hyperSessions.hasHyperSessions,
    onToggleTerminal: toggleTerminal,
    isTerminalOpen,
  } as SidebarProps;

  // Mobile layout - three views: sidebar, session, terminal
  const mobileLayout = (
    <div ref={mobileContainerRef} className="relative h-full md:hidden overflow-hidden">
      {/* Slide track - shifts between sidebar and session */}
      <div
        className={`flex h-full w-full ${hydrated ? "transition-transform duration-300 ease-in-out" : ""}`}
        style={{ transform: `translateX(-${mobileTrackIndex * 100}%)` }}
      >
        {/* Sidebar */}
        <div className="h-full w-full shrink-0">
          <Sidebar {...sidebarProps} />
        </div>

        {/* Session View */}
        <div className="h-full w-full shrink-0">
          {primarySelectedSessionId && (
            <SessionPager
              panes={openPanes}
              selectedSessionId={primarySelectedSessionId}
              streamingSessionIds={streamingSessionIds}
              unreadSessionIds={unreadSessionIds}
              onBack={() => handleSessionSelect(null)}
              onSetArtifactPaneMode={setArtifactPaneMode}
              models={models}
              modelConfiguration={selectedModelConfiguration}
              onModelConfigurationChange={handleModelConfigurationChange}
            />
          )}
        </div>
      </div>

      {/* Terminal overlay (separate layer to avoid transform on input) */}
      <div
        className={`absolute inset-y-0 w-full ${
          hydrated ? "transition-[left] duration-300 ease-in-out" : ""
        } ${mobileView === "terminal" ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{ left: mobileView === "terminal" ? "0%" : "100%" }}
      >
        <div className="h-full">
          {shouldRenderMobileTerminalShell && (
            <TerminalShell onClose={handleTerminalClose} onQuickKey={handleTerminalQuickKey}>
              {isMobileLayout ? terminalBody : terminalBodySkeleton}
            </TerminalShell>
          )}
        </div>
      </div>
    </div>
  );

  // Desktop layout - resizable panels
  const desktopLayout = (
    <div className="h-full hidden md:block">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Left Sidebar - Sessions List */}
        <ResizablePanel
          ref={sidebarPanelRef}
          id="sidebar"
          order={1}
          defaultSize={isSidebarOpen ? sidebarSize : 0}
          minSize={8}
          maxSize={40}
          collapsible
          collapsedSize={0}
          onResize={handleSidebarResize}
          onCollapse={() => setIsSidebarOpen(false)}
          onExpand={() => setIsSidebarOpen(true)}
          className={!isSidebarDragging ? "panel-transition" : ""}
        >
          <div className={`h-full border-r ${isCollapsed ? "hidden" : ""}`}>
            <Sidebar {...sidebarProps} onCollapse={toggleSidebar} />
          </div>
        </ResizablePanel>

        <ResizableHandle
          onDragging={handleSidebarDragging}
          className={isCollapsed ? "hidden" : ""}
        />

        {/* Right Panel - Chat View + Terminal */}
        <ResizablePanel
          order={2}
          defaultSize={isSidebarOpen ? 100 - sidebarSize : 100}
          className={!isSidebarDragging ? "panel-transition" : ""}
        >
          <ResizablePanelGroup direction="vertical" className="h-full">
            {/* Main content area - Chat sessions */}
            <ResizablePanel order={1} defaultSize={isTerminalOpen ? 100 - terminalSize : 100}>
              <div className="h-full overflow-hidden relative">
                {/* Expand button when collapsed */}
                {showExpandButton && (
                  <button
                    onClick={toggleSidebar}
                    className="absolute top-3 left-3 z-10 text-muted-foreground hover:text-foreground"
                    aria-label="Expand sidebar"
                  >
                    <PanelLeft className="h-5 w-5" />
                  </button>
                )}
                {openPanes.length > 0 ? (
                  <SessionGrid
                    panes={openPanes}
                    streamingSessionIds={streamingSessionIds}
                    unreadSessionIds={unreadSessionIds}
                    onRemovePane={handleCloseVisiblePane}
                    onSetArtifactPaneMode={setArtifactPaneMode}
                    models={models}
                    modelConfiguration={selectedModelConfiguration}
                    onModelConfigurationChange={handleModelConfigurationChange}
                  />
                ) : (
                  <WorkspacePlaceholder />
                )}
              </div>
            </ResizablePanel>

            {/* Terminal drawer (collapsible from bottom) */}
            <ResizableHandle onDragging={handleTerminalDragging} />
            <ResizablePanel
              ref={terminalPanelRef}
              id="terminal"
              order={2}
              defaultSize={isTerminalOpen ? terminalSize : 0}
              minSize={15}
              maxSize={80}
              collapsible
              collapsedSize={0}
              onResize={handleTerminalResize}
              onCollapse={() => setIsTerminalOpen(false)}
              onExpand={() => setIsTerminalOpen(true)}
              className={!isTerminalDragging ? "panel-transition" : ""}
            >
              {isTerminalMounted && (
                <div className="h-full border-t">
                  <TerminalShell onClose={handleTerminalClose} onQuickKey={handleTerminalQuickKey}>
                    {!isMobileLayout ? terminalBody : terminalBodySkeleton}
                  </TerminalShell>
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
      {hyperSession?.open && (
        <HyperSession
          state={hyperSession}
          setHyperSession={hyperSessions.setHyperSession}
          streamingSessionIds={streamingSessionIds}
          unreadSessionIds={unreadSessionIds}
          models={models}
          modelConfiguration={selectedModelConfiguration}
          onModelConfigurationChange={handleModelConfigurationChange}
          onClose={hyperSessions.close}
          onMinimize={hyperSessions.minimize}
          onPromote={hyperSessions.promote}
        />
      )}
    </div>
  );

  return (
    <WorkspaceProvider value={workspace.actions}>
      <div className="h-full overflow-hidden">
        {!hydrated ? (
          <>
            {mobileLayout}
            {desktopLayout}
          </>
        ) : isMobileLayout ? (
          mobileLayout
        ) : (
          desktopLayout
        )}
      </div>
      <RenameDialog
        open={renameTargetId !== null}
        session={renameTargetSession}
        isSubmitting={renameTargetId !== null && renamingSessionId === renameTargetId}
        onOpenChange={handleRenameDialogOpenChange}
        onRenameSession={async (input) => {
          await renameMutation.mutateAsync(input);
        }}
      />
    </WorkspaceProvider>
  );
}
