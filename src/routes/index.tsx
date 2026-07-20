import { useHotkey } from "@tanstack/react-hotkeys";
import { createFileRoute, useNavigate, ClientOnly } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { useState, useRef, useEffect, useDeferredValue, lazy, Suspense } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useAtom } from "jotai";
import { z } from "zod";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { PanelLeft } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { deleteSession, renameSession } from "@/functions/sessions";
import { workspaceQueries } from "@/lib/queries";
import { useDrafts } from "@/hooks/workspace/useDrafts";
import { useHyperSession, type HyperSessionState } from "@/hooks/workspace/layout/useHyperSession";
import { useSessions } from "@/hooks/session/useSessions";
import { useWorkspaceSync } from "@/hooks/workspace/useWorkspaceSync";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { useViewport } from "@/hooks/browser/useViewport";
import { usePanelTransition } from "@/hooks/browser/usePanelTransition";
import { Sidebar, type SidebarProps } from "@/components/sidebar/Sidebar";
import { RenameSessionDialog } from "@/components/sidebar/list/RenameSessionDialog";
import { WorkspaceGrid } from "@/components/workspace/layout/WorkspaceGrid";
import { HyperSession } from "@/components/workspace/layout/HyperSession";
import { WorkspacePager } from "@/components/workspace/layout/WorkspacePager";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import { WorkspaceSurfaceProvider } from "@/hooks/workspace/layout/focus";
import {
  clearLinkedPanes,
  linkedPanesStore,
  prunePanePublishers,
} from "@/hooks/workspace/layout/linkedPanes";
import {
  deriveOpenSessionIds,
  deriveReachablePaneIds,
  deriveVisibleWorkspacePanes,
  deriveWorkspaceRootPanes,
  INBOX_PANE,
} from "@/lib/workspace/panes";
import { parseLayoutPrefs, resolveLayoutPrefs } from "@/lib/config/layoutPrefs";
import { DEFAULT_SETTINGS, showExternalSessionsAtom } from "@/lib/config/settings";
import { useLayoutCookie } from "@/hooks/browser/useLayoutCookie";
import {
  cancelSessionsStateQuery,
  removeSessionFromState,
  restoreSessionsState,
  snapshotSessionsState,
  upsertSessionInState,
} from "@/lib/session/queryCache";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
const Terminal = lazy(() =>
  import("@/components/terminal/Terminal").then((m) => ({ default: m.Terminal })),
);

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
  component: WorkspacePage,
});

const readLayoutCookieHeader = createIsomorphicFn()
  .client(() => document.cookie)
  .server(async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("cookie") ?? getRequestHeader("Cookie");
  });

async function loadLayoutPrefs() {
  const cookieHeader = await readLayoutCookieHeader();
  return resolveLayoutPrefs(parseLayoutPrefs(cookieHeader));
}

function closeTerminal() {
  if (typeof window === "undefined") return;
  void import("@/lib/terminal/terminalManager").then(({ terminalManager }) => {
    terminalManager.close();
  });
}

function sendTerminalInput(data: string) {
  if (typeof window === "undefined") return;
  void import("@/lib/terminal/terminalManager").then(({ terminalManager }) => {
    terminalManager.sendInput(data);
  });
}

type HyperLayoutState = Pick<HyperSessionState, "open" | "position">;

function restoreHyperSessionState(
  sessionId: string | undefined,
  layout: HyperLayoutState,
): HyperSessionState | null {
  return sessionId ? { sessionId, ...layout } : null;
}

function WorkspacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedSessionIds = Route.useSearch({
    select: (search) => search.sessionIds ?? [],
    structuralSharing: true,
  });
  const {
    sidebarSize: initialSidebarSize,
    terminalSize: initialTerminalSize,
    sidebarOpen: initialSidebarOpen,
    terminalOpen: initialTerminalOpen,
    automationsExpanded: initialAutomationsExpanded,
    hyperOpen: initialHyperOpen,
    hyperPosition: initialHyperPosition,
    mobileInboxOpen: initialMobileInboxOpen,
  } = Route.useLoaderData();
  const { isMobile: isMobileLayout, hydrated } = useViewport();
  const [isMobileInboxOpen, setIsMobileInboxOpen] = useState(initialMobileInboxOpen);

  function updateSelectedSessionIds(
    nextSelectedSessionIds: string[],
    options?: { replace?: boolean },
  ) {
    navigate({
      to: "/",
      search: nextSelectedSessionIds.length > 0 ? { sessionIds: nextSelectedSessionIds } : {},
      replace: options?.replace,
    });
  }

  const primarySelectedSessionId = selectedSessionIds[0];
  const linkedPanesByPublisher = useSelector(linkedPanesStore);
  const rootPanes = deriveWorkspaceRootPanes(selectedSessionIds);
  const reachablePaneIds = deriveReachablePaneIds(rootPanes, linkedPanesByPublisher);
  const openPanes = deriveVisibleWorkspacePanes({
    rootPanes,
    linkedPanesByPublisher,
  });
  const openSessionIds = deriveOpenSessionIds(openPanes);

  const [storedShowExternalSessions, setShowExternalSessions] = useAtom(showExternalSessionsAtom);
  const showExternalSessions = hydrated
    ? storedShowExternalSessions
    : DEFAULT_SETTINGS.showExternalSessions;

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
    sessions,
    recentSessions,
    isLoading: isSessionsLoading,
    worktreeSessionIds,
    workerSessionIds,
  } = useSessions();
  const { automationSessionIds, environment, hyperSessionIds, inboxSessionIds } =
    useWorkspaceSelector((workspace) => ({
      automationSessionIds: workspace.automations.map((automation) => automation.id),
      environment: workspace.environment,
      hyperSessionIds: workspace.hyperSessionIds,
      inboxSessionIds: workspace.inboxEntries.map((entry) => entry.id),
    }));
  useWorkspaceSync();
  const { listedDrafts, isDraft, createDraft, discardDraft } = useDrafts({
    sessions,
    hyperSessionIds,
  });

  const managedSessionIds = new Set([
    ...automationSessionIds,
    ...inboxSessionIds,
    ...hyperSessionIds,
    ...workerSessionIds,
  ]);
  function handleCloseVisibleSession(sessionId: string) {
    if (!selectedSessionIds.includes(sessionId)) return;
    updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionId));
  }

  function handleSessionSelect(sessionId: string, toggleInWorkspace = false) {
    if (!toggleInWorkspace || isMobileLayout) {
      if (isMobileLayout) setIsMobileInboxOpen(false);
      updateSelectedSessionIds([sessionId]);
      return;
    }

    if (selectedSessionIds.includes(sessionId)) {
      handleCloseVisibleSession(sessionId);
      return;
    }

    if (
      selectedSessionIds.length > 0 &&
      openPanes.length >= 4 &&
      !openSessionIds.includes(sessionId)
    )
      return;
    updateSelectedSessionIds([...selectedSessionIds, sessionId]);
  }

  // Create a client-side draft, optionally alongside the current workspace.
  function handleCreateSession(addToWorkspace = false) {
    const id = createDraft();
    if (isMobileLayout) setIsMobileInboxOpen(false);

    if (addToWorkspace && openSessionIds.length > 0 && openSessionIds.length < 4) {
      // Add to the workspace.
      updateSelectedSessionIds([...selectedSessionIds, id]);
    } else {
      // Replace current view
      updateSelectedSessionIds([id]);
    }
  }

  // Keep URL session IDs aligned with available sessions.
  // This prevents stale open panes when another client deletes a session.
  useEffect(() => {
    if (isSessionsLoading) return;
    if (selectedSessionIds.length === 0) return;

    const availableSessionIds = new Set(sessions.map((session) => session.sessionId));
    for (const draft of listedDrafts) availableSessionIds.add(draft.sessionId);
    for (const sessionId of hyperSessionIds) availableSessionIds.add(sessionId);
    for (const sessionId of automationSessionIds) availableSessionIds.add(sessionId);

    const validSessionIds = selectedSessionIds.filter((sessionId) =>
      availableSessionIds.has(sessionId),
    );

    if (validSessionIds.length === selectedSessionIds.length) return;

    navigate({
      to: "/",
      search: validSessionIds.length > 0 ? { sessionIds: validSessionIds } : {},
      replace: true,
    });
  }, [
    automationSessionIds,
    hyperSessionIds,
    isSessionsLoading,
    listedDrafts,
    navigate,
    selectedSessionIds,
    sessions,
  ]);

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
  const isTerminalAnimating = usePanelTransition("terminal");
  const isTerminalMounted = isTerminalOpen || isTerminalAnimating;

  // Animate terminal panel open/close (mirrors WorkspaceGrid's effect pattern).
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
  useLayoutCookie("mobileInboxOpen", hydrated && isMobileLayout ? isMobileInboxOpen : undefined);

  function handleSidebarResize(size: number) {
    if (size > 0) {
      sidebarSizeRef.current = size;
      if (!isSidebarDraggingRef.current) {
        setSidebarSize(size);
      }
    }
  }

  function handleTerminalResize(size: number) {
    if (size > 0) {
      terminalSizeRef.current = size;
      if (!isTerminalDraggingRef.current) {
        setTerminalSize(size);
      }
    }
  }

  function handleSidebarDragging(dragging: boolean) {
    isSidebarDraggingRef.current = dragging;
    setIsSidebarDragging(dragging);
    if (!dragging) {
      setSidebarSize(sidebarSizeRef.current);
    }
  }

  function handleTerminalDragging(dragging: boolean) {
    isTerminalDraggingRef.current = dragging;
    setIsTerminalDragging(dragging);
    if (!dragging) {
      setTerminalSize(terminalSizeRef.current);
    }
  }

  // Pause PTY resize during sidebar open/close animation
  const isSidebarAnimating = usePanelTransition("sidebar");

  const isCollapsed = !isSidebarOpen;
  const showExpandButton = isCollapsed && !isSidebarAnimating;

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

  function toggleTerminal() {
    setIsTerminalOpen((prev) => !prev);
  }

  // Global keyboard shortcuts
  useHotkey("Mod+B", toggleSidebar, {
    enabled: !isMobileLayout,
    requireReset: true,
  });
  useHotkey("Control+N", () => handleCreateSession(), {
    requireReset: true,
  });
  useHotkey("Control+`", toggleTerminal, { requireReset: true });

  function handleTerminalClose() {
    closeTerminal();
    setIsTerminalOpen(false);
  }

  const handleTerminalQuickKey = sendTerminalInput;

  const deferredFilter = useDeferredValue(filter);

  // Managed sessions are presented by their automation, inbox, hyper, or parent surface.
  let filteredSessions = recentSessions.filter(
    (session) => !managedSessionIds.has(session.sessionId),
  );

  if (!showExternalSessions) {
    filteredSessions = filteredSessions.filter((session) =>
      session.sessionId.startsWith(SESSION_ID_PREFIX),
    );
  }

  // Finally apply the text filter on summary.
  const lowerFilter = deferredFilter.trim().toLowerCase();
  if (lowerFilter) {
    filteredSessions = filteredSessions.filter((session) =>
      session.summary?.toLowerCase().includes(lowerFilter),
    );
  }

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession({ data: { sessionId } }),
    onMutate: async (sessionId) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await cancelSessionsStateQuery(queryClient);

      // Snapshot the previous value for rollback
      const previousSessionsState = snapshotSessionsState(queryClient);

      // Optimistically remove from cache
      removeSessionFromState(queryClient, sessionId);

      // Return context with the snapshot for rollback
      return { previousSessionsState };
    },
    onError: (_err, _sessionId, context) => {
      // Rollback to the previous value on error
      if (context?.previousSessionsState) {
        restoreSessionsState(queryClient, context.previousSessionsState);
      }
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) =>
      renameSession({ data: { sessionId, name } }),
    onMutate: async ({ sessionId, name }) => {
      await cancelSessionsStateQuery(queryClient);

      const previousSessionsState = snapshotSessionsState(queryClient);
      upsertSessionInState(queryClient, {
        sessionId,
        summary: name,
      });

      return { previousSessionsState };
    },
    onError: (_err, _input, context) => {
      if (context?.previousSessionsState) {
        restoreSessionsState(queryClient, context.previousSessionsState);
      }
    },
  });
  const deletingSessionId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null;
  const renamingSessionId = renameMutation.isPending
    ? (renameMutation.variables?.sessionId ?? null)
    : null;

  function handleSessionDelete(sessionIdToDelete: string) {
    if (isDraft(sessionIdToDelete)) {
      discardDraft(sessionIdToDelete);
    } else {
      deleteMutation.mutate(sessionIdToDelete);
    }

    if (selectedSessionIds.includes(sessionIdToDelete)) {
      if (isMobileLayout) setIsMobileInboxOpen(false);
      updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionIdToDelete));
    }
  }

  const renameTargetSession =
    sessions.find((session) => session.sessionId === renameTargetId) ?? null;

  function handleSessionRename(sessionId: string) {
    setRenameTargetId(sessionId);
  }

  function handleRenameDialogOpenChange(open: boolean) {
    if (!open) {
      setRenameTargetId(null);
    }
  }

  function openSessionInWorkspace(sessionId: string) {
    if (!selectedSessionIds.includes(sessionId)) {
      const nextSelectedSessionIds =
        openPanes.length >= 4 && !openSessionIds.includes(sessionId)
          ? [sessionId]
          : [...selectedSessionIds, sessionId];
      updateSelectedSessionIds(nextSelectedSessionIds);
    }
  }

  const hyperSessionId = hyperSessionIds[0];
  const restoredHyperSession = restoreHyperSessionState(hyperSessionId, {
    position: initialHyperPosition,
    open: initialHyperOpen,
  });

  const hyper = useHyperSession({
    initialState: restoredHyperSession,
    hyperSessionId,
    createDraft,
    deleteSession: handleSessionDelete,
    openSessionInWorkspace,
  });
  const hyperSession = hyper.state;
  const { getOrCreateSessionId: getOrCreateHyperSessionId, toggle: toggleHyperSession } = hyper;

  useLayoutCookie("hyperOpen", hyper.isOpen);
  useLayoutCookie("hyperPosition", hyperSession?.position);

  // The hyper session has no floating deck on mobile; opening it there means
  // selecting it into the main view — the same URL navigation any list session
  // uses — so a reload restores it through the existing selected-session SSR.
  function toggleHyper() {
    if (!isMobileLayout) {
      toggleHyperSession();
      return;
    }
    setIsMobileInboxOpen(false);
    updateSelectedSessionIds([getOrCreateHyperSessionId()]);
  }

  // "Open" is viewport-relative: the deck is open on desktop; on mobile the hyper
  // session is open when it's the one in view. The sidebar dot is its inverse.
  const isHyperOpen = isMobileLayout
    ? hyperSessionId !== undefined && primarySelectedSessionId === hyperSessionId
    : hyper.isOpen;

  // The hyper deck publishes linked panes under its session pane id, which the
  // "selected" reachable set doesn't include — union it in so those panes survive
  // pruning. Pane reachability also follows any linked sub-sessions.
  useEffect(() => {
    const hyperReachablePaneIds = hyperSession
      ? deriveReachablePaneIds(
          deriveWorkspaceRootPanes([hyperSession.sessionId]),
          linkedPanesByPublisher,
        )
      : [];
    prunePanePublishers(new Set([...reachablePaneIds, ...hyperReachablePaneIds]));
  }, [hyperSession, linkedPanesByPublisher, reachablePaneIds]);

  const hasSelectedSession = selectedSessionIds.length > 0;
  const isInboxOpen = !hasSelectedSession && (!isMobileLayout || isMobileInboxOpen);

  function handleOpenInbox() {
    if (isMobileLayout) setIsMobileInboxOpen(true);
    if (hasSelectedSession) updateSelectedSessionIds([]);
  }

  function handleMobileWorkspaceBack() {
    clearLinkedPanes(INBOX_PANE.id);
    setIsMobileInboxOpen(false);
    if (hasSelectedSession) updateSelectedSessionIds([]);
  }

  const baseMobileView = hasSelectedSession
    ? "workspace"
    : isMobileInboxOpen
      ? "workspace"
      : "sidebar";
  const mobileView = isTerminalOpen ? "terminal" : baseMobileView;
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
          wsPort={environment.terminalWsPort}
        />
      </Suspense>
    </ClientOnly>
  );

  // Shared sidebar props for both mobile and desktop
  const sidebarProps = {
    filter,
    onFilterChange: setFilter,
    showExternalSessions,
    onShowExternalSessionsChange: setShowExternalSessions,
    sessions: filteredSessions,
    isSessionsLoading,
    onSessionSelect: handleSessionSelect,
    onSessionRename: handleSessionRename,
    onSessionDelete: handleSessionDelete,
    deletingSessionId,
    openSessionIds,
    worktreeSessionIds,
    emptyMessage: deferredFilter ? "No sessions match your filter" : undefined,
    draftSessions: listedDrafts,
    isAutomationsExpanded,
    onAutomationsExpandedChange: setIsAutomationsExpanded,
    onCreateSession: handleCreateSession,
    onToggleHyper: toggleHyper,
    isHyperOpen,
    onOpenInbox: handleOpenInbox,
    isInboxOpen,
    onToggleTerminal: toggleTerminal,
    isTerminalOpen,
  } satisfies SidebarProps;

  // Mobile layout - three views: sidebar, workspace, terminal
  const mobileLayout = (
    <div ref={mobileContainerRef} className="relative h-full md:hidden overflow-hidden">
      {/* Slide track - shifts between sidebar and workspace */}
      <div
        className={`flex h-full w-full ${hydrated ? "transition-transform duration-300 ease-in-out" : ""}`}
        style={{ transform: `translateX(-${mobileTrackIndex * 100}%)` }}
      >
        {/* Sidebar */}
        <div className="h-full w-full shrink-0">
          <Sidebar {...sidebarProps} />
        </div>

        {/* Workspace View */}
        <div className="h-full w-full shrink-0">
          {baseMobileView === "workspace" && (
            <WorkspacePager
              panes={openPanes}
              primaryPaneId={rootPanes[0].id}
              onBack={handleMobileWorkspaceBack}
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
            {/* Main workspace */}
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
                <WorkspaceGrid panes={openPanes} onCloseSession={handleCloseVisibleSession} />
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
          onPositionChange={hyper.setPosition}
          onDelete={hyper.deleteSession}
          onMinimize={hyper.toggle}
          onPromote={hyper.promote}
        />
      )}
    </div>
  );

  return (
    <>
      <WorkspaceSurfaceProvider surface="main" panes={openPanes}>
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
      </WorkspaceSurfaceProvider>
      <RenameSessionDialog
        open={renameTargetId !== null}
        session={renameTargetSession}
        isSubmitting={renameTargetId !== null && renamingSessionId === renameTargetId}
        onOpenChange={handleRenameDialogOpenChange}
        onRenameSession={async (input) => {
          await renameMutation.mutateAsync(input);
        }}
      />
    </>
  );
}
