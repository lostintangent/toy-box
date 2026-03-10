import { useHotkey } from "@tanstack/react-hotkeys";
import { createFileRoute, useNavigate, ClientOnly } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useState, useMemo, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { PanelLeft } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { destroySession } from "@/functions/sessions";
import { getRuntimeConfig } from "@/functions/config";
import { modelQueries } from "@/lib/queries";
import { useAutomations } from "@/hooks/automations/useAutomations";
import { useLocalStorage } from "@/hooks/browser/useLocalStorage";
import { useSessions } from "@/hooks/session/useSessions";
import { useViewport } from "@/hooks/browser/ViewportContext";
import { usePanelTransition } from "@/hooks/browser/usePanelTransition";
import { generateUUID } from "@/lib/utils";
import type { SessionMetadata } from "@/types";
import { Sidebar, SidebarProps } from "@/components/sidebar/Sidebar";
import { SessionView } from "@/components/session/SessionView";
import { SessionGrid } from "@/components/session/SessionGrid";
import { SessionPlaceholder } from "@/components/session/SessionPlaceholder";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import {
  normalizeSessionDirectoryOptions,
  type SessionDirectoryOption,
} from "@/components/session/sessionDirectoryOptions";
import {
  AUTOMATIONS_EXPANDED_COOKIE,
  buildLayoutCookie,
  parseLayoutPrefs,
  resolveLayoutPrefs,
  SIDEBAR_OPEN_COOKIE,
  SIDEBAR_SIZE_COOKIE,
  TERMINAL_OPEN_COOKIE,
  TERMINAL_SIZE_COOKIE,
} from "@/lib/config/layoutPrefs";
import {
  cancelSessionsState,
  getSessionsStateSnapshot,
  prependSessionIfMissing,
  removeSessionFromState,
  replaceSessionsState,
} from "@/lib/session/sessionsCache";
const Terminal = lazy(() =>
  import("@/components/terminal/Terminal").then((m) => ({ default: m.Terminal })),
);

/** Session ID prefix for sessions created by this web app */
const SESSION_ID_PREFIX = "toy-box-";

const SELECTED_MODEL_KEY = "selected-model";
const SESSION_SOURCE_FILTER_KEY = "session-source-filter";

const searchSchema = z.object({
  sessionIds: z.array(z.string()).max(4).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(searchSchema),
  loader: async () => loadLayoutPrefs(),
  component: SessionsPage,
});

const EMPTY_SESSION_IDS: string[] = [];

async function loadLayoutPrefs() {
  const runtimeConfig = await getRuntimeConfig();

  if (import.meta.env.SSR) {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const cookieHeader = getRequestHeader("cookie") ?? getRequestHeader("Cookie");
    return {
      ...resolveLayoutPrefs(parseLayoutPrefs(cookieHeader)),
      terminalWsPort: runtimeConfig.terminalWsPort,
    };
  }

  return {
    ...resolveLayoutPrefs(parseLayoutPrefs(document.cookie)),
    terminalWsPort: runtimeConfig.terminalWsPort,
  };
}

function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const sessionIds = search?.sessionIds ?? EMPTY_SESSION_IDS;
  const {
    sidebarSize: initialSidebarSize,
    terminalSize: initialTerminalSize,
    sidebarOpen: initialSidebarOpen,
    terminalOpen: initialTerminalOpen,
    automationsExpanded: initialAutomationsExpanded,
    terminalWsPort,
  } = Route.useLoaderData();

  const { allSessions, sessions, isLoading, streamingSessionIds, unreadSessionIds } = useSessions({
    openSessionIds: sessionIds,
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
      navigate({ to: "/", search: { sessionIds: [sessionId] } });
    },
    streamingSessionIds,
  });
  const availableSessionIds = useMemo(() => {
    const ids = new Set(allSessions.map((session) => session.sessionId));
    for (const automation of automations) {
      if (!automation.lastRunSessionId) continue;
      ids.add(automation.lastRunSessionId);
    }
    return ids;
  }, [allSessions, automations]);
  const { data: models = [] } = useQuery(modelQueries.list());

  // Persisted state (synced with localStorage)
  const [selectedModel, setSelectedModel] = useLocalStorage<string>(SELECTED_MODEL_KEY, "");
  const [sourceFilter, setSourceFilter] = useLocalStorage(SESSION_SOURCE_FILTER_KEY, "toy-box");

  // Default to first model if none selected
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].id);
    }
  }, [models, selectedModel, setSelectedModel]);
  const [sidebarSize, setSidebarSize] = useState(initialSidebarSize);
  const [terminalSize, setTerminalSize] = useState(initialTerminalSize);
  const [isSidebarOpen, setIsSidebarOpen] = useState(initialSidebarOpen);

  // Terminal state - synced with cookie (SSR-safe)
  const [isTerminalOpen, setIsTerminalOpen] = useState(initialTerminalOpen);
  const [isAutomationsExpanded, setIsAutomationsExpanded] = useState(initialAutomationsExpanded);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);

  const { isMobile: isMobileLayout, hydrated } = useViewport();
  const shouldRenderMobileTerminalShell = import.meta.env.SSR
    ? initialTerminalOpen
    : isTerminalOpen;

  // Draft session state - tracks a session that hasn't been created on the server yet
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null);

  // Create a new draft session (client-side only until first message)
  // With modifier key (Cmd/Ctrl), adds to the grid instead of replacing
  const handleCreateSession = useCallback(
    (e?: React.MouseEvent) => {
      const id = `${SESSION_ID_PREFIX}${generateUUID()}`;
      setDraftSessionId(id);

      const hasModifier = e?.metaKey || e?.ctrlKey;
      if (hasModifier && sessionIds.length > 0 && sessionIds.length < 4) {
        // Add to grid
        navigate({ to: "/", search: { sessionIds: [...sessionIds, id] } });
      } else {
        // Replace current view
        navigate({ to: "/", search: { sessionIds: [id] } });
      }
    },
    [navigate, sessionIds],
  );

  // Called when draft session is created on server (after first message)
  // Don't clear draftSessionId here - let the draftSession memo handle the
  // transition naturally when the server session appears in the list
  const handleDraftSessionCreated = useCallback(
    (sessionId: string) => {
      if (sessionId !== draftSessionId) return;

      // Immediately add the new session to the cache so it persists across navigation.
      // This ensures the session remains visible even if the user navigates back
      // before the next automatic refetch.
      prependSessionIfMissing(queryClient, {
        sessionId,
        startTime: new Date(),
        modifiedTime: new Date(),
        summary: "",
        isRemote: false,
      });
    },
    [draftSessionId, queryClient],
  );

  // Create draft session object (separate from sessions list for animation)
  // Returns null if draft is already in server list, enabling smooth handoff
  const draftSession = useMemo<SessionMetadata | null>(() => {
    if (!draftSessionId) return null;
    // Don't show draft if it's already in the server list - this enables
    // a smooth transition where the server session renders before draft unmounts
    if (sessions.some((s) => s.sessionId === draftSessionId)) return null;
    return {
      sessionId: draftSessionId,
      startTime: new Date(),
      modifiedTime: new Date(),
      summary: "",
      isRemote: false,
    };
  }, [draftSessionId, sessions]);

  // Clear stale draftSessionId once session is in server list
  useEffect(() => {
    if (draftSessionId && sessions.some((s) => s.sessionId === draftSessionId)) {
      setDraftSessionId(null);
    }
  }, [draftSessionId, sessions]);

  // Keep URL session IDs aligned with available sessions.
  // This prevents stale open panes when another client deletes a session.
  useEffect(() => {
    if (isLoading) return;
    if (sessionIds.length === 0) return;

    const validSessionIds = sessionIds.filter((sessionId) => {
      if (sessionId === draftSessionId) return true;
      return availableSessionIds.has(sessionId);
    });

    if (validSessionIds.length === sessionIds.length) return;

    navigate({
      to: "/",
      search: validSessionIds.length > 0 ? { sessionIds: validSessionIds } : {},
      replace: true,
    });
  }, [availableSessionIds, draftSessionId, isLoading, navigate, sessionIds]);

  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
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
    document.cookie = buildLayoutCookie(SIDEBAR_OPEN_COOKIE, isSidebarOpen);
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!Number.isFinite(sidebarSize)) return;
    document.cookie = buildLayoutCookie(SIDEBAR_SIZE_COOKIE, sidebarSize);
  }, [sidebarSize]);

  useEffect(() => {
    terminalSizeRef.current = terminalSize;
  }, [terminalSize]);

  useEffect(() => {
    document.cookie = buildLayoutCookie(TERMINAL_OPEN_COOKIE, isTerminalOpen);
  }, [isTerminalOpen]);

  useEffect(() => {
    if (!Number.isFinite(terminalSize)) return;
    document.cookie = buildLayoutCookie(TERMINAL_SIZE_COOKIE, terminalSize);
  }, [terminalSize]);

  useEffect(() => {
    document.cookie = buildLayoutCookie(AUTOMATIONS_EXPANDED_COOKIE, isAutomationsExpanded);
  }, [isAutomationsExpanded]);

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

  // Hide reusable automation sessions from the main session list, then apply source/text filters.
  const filteredSessions = useMemo(() => {
    const hiddenReusableAutomationSessionIds = new Set<string>();
    for (const automation of automations) {
      if (!automation.reuseSession || !automation.lastRunSessionId) continue;
      hiddenReusableAutomationSessionIds.add(automation.lastRunSessionId);
    }

    let result = sessions.filter(
      (session) => !hiddenReusableAutomationSessionIds.has(session.sessionId),
    );

    // Then apply the source filter (Toy Box vs All)
    if (sourceFilter === "toy-box") {
      result = result.filter((session) => session.sessionId.startsWith(SESSION_ID_PREFIX));
    }

    // Finally apply the text filter on summary.
    const lowerFilter = filter.trim().toLowerCase();
    if (!lowerFilter) return result;

    return result.filter((session) => session.summary?.toLowerCase().includes(lowerFilter));
  }, [sessions, automations, filter, sourceFilter]);

  const directoryOptions = useMemo<SessionDirectoryOption[]>(() => {
    const rawOptions = sessions.reduce<SessionDirectoryOption[]>((acc, session) => {
      const cwd = session.context?.cwd?.trim();
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
    mutationFn: (sessionId: string) => destroySession({ data: { sessionId } }),
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

  const handleSessionSelect = useCallback(
    (selectedSessionId: string | null, modifierKey: boolean = false) => {
      if (selectedSessionId === null) {
        navigate({ to: "/", search: {} });
        return;
      }

      // Normal click: Always reset to single session (ephemeral grids)
      if (!modifierKey) {
        navigate({ to: "/", search: { sessionIds: [selectedSessionId] } });
        return;
      }

      // Cmd/Ctrl+click: Add to or remove from grid (desktop only)
      // Note: Mobile behavior unchanged - modifier keys not supported
      const currentSessionIds = sessionIds;
      if (currentSessionIds.includes(selectedSessionId)) {
        // Remove from grid
        const updated = currentSessionIds.filter((id) => id !== selectedSessionId);
        navigate({ to: "/", search: updated.length > 0 ? { sessionIds: updated } : {} });
      } else if (currentSessionIds.length < 4) {
        // Add to grid (max 4)
        navigate({ to: "/", search: { sessionIds: [...currentSessionIds, selectedSessionId] } });
      }
    },
    [navigate, sessionIds],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      // If deleting a draft session, just clear the draft state (no server call)
      if (sessionIdToDelete === draftSessionId) {
        setDraftSessionId(null);
      } else {
        deleteMutation.mutate(sessionIdToDelete);
      }

      // If deleting an open session, remove it from the grid
      if (sessionIds.includes(sessionIdToDelete)) {
        const updated = sessionIds.filter((id) => id !== sessionIdToDelete);
        navigate({ to: "/", search: updated.length > 0 ? { sessionIds: updated } : {} });
      }
    },
    [draftSessionId, deleteMutation, sessionIds, navigate],
  );

  const hasSelectedSession = sessionIds.length > 0;

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
      <div className="h-5 w-75 max-w-full rounded-md bg-white/5 animate-pulse" />
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
    sourceFilter,
    onSourceFilterChange: setSourceFilter,
    sessions: filteredSessions,
    isLoading,
    onSessionSelect: handleSessionSelect,
    onSessionDelete: handleSessionDelete,
    deletingSessionId,
    activeSessionIds: sessionIds,
    streamingSessionIds,
    unreadSessionIds,
    emptyMessage: filter ? "No sessions match your filter" : undefined,
    draftSession,
    directoryOptions,
    automations,
    isAutomationsLoading,
    models,
    defaultAutomationModelId: selectedModel,
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
          {sessionIds[0] && (
            <SessionView
              sessionId={sessionIds[0]}
              isSessionRunning={streamingSessionIds.includes(sessionIds[0])}
              isSessionUnread={unreadSessionIds.includes(sessionIds[0])}
              onBack={() => handleSessionSelect(null)}
              models={models}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              draftSessionId={draftSessionId}
              onDraftSessionCreated={handleDraftSessionCreated}
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
                {sessionIds.length > 0 ? (
                  <SessionGrid
                    sessionIds={sessionIds}
                    streamingSessionIds={streamingSessionIds}
                    unreadSessionIds={unreadSessionIds}
                    onRemoveSession={(sessionIdToRemove) => {
                      const updated = sessionIds.filter((id) => id !== sessionIdToRemove);
                      navigate({
                        to: "/",
                        search: updated.length > 0 ? { sessionIds: updated } : {},
                      });
                    }}
                    models={models}
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                    draftSessionId={draftSessionId}
                    onDraftSessionCreated={handleDraftSessionCreated}
                  />
                ) : (
                  <SessionPlaceholder />
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
    </div>
  );

  return (
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
  );
}
