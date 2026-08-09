import { useHotkey } from "@tanstack/react-hotkeys";
import { createFileRoute, useNavigate, useRouterState, ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { useState, useRef, useEffect, useDeferredValue, lazy, Suspense } from "react";
import { useSelector } from "@tanstack/react-store";
import { z } from "zod";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/shared/components/ui/resizable";
import { useDrafts } from "@sessions/useDrafts";
import { useHyperSession, type HyperSessionState } from "@workspace/hooks/layout/useHyperSession";
import { useWarmSessionSnapshots } from "@sessions/useWarmSessionSnapshots";
import { useWorkspaceSync } from "@workspace/hooks/useWorkspaceSync";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import { useViewport } from "@/shared/hooks/useViewport";
import { usePanelTransition } from "@workspace/hooks/layout/usePanelTransition";
import { NameDialog } from "@/shared/components/sidebar/NameDialog";
import { Sidebar, type SidebarProps } from "@workspace/components/sidebar/Sidebar";
import { WorkspaceGrid } from "@workspace/components/layout/WorkspaceGrid";
import { HyperSession } from "@workspace/components/layout/HyperSession";
import { WorkspacePager } from "@workspace/components/layout/WorkspacePager";
import { TerminalShell } from "@terminal/components/TerminalShell";
import {
  focusWorkspaceSurfacePane,
  workspaceSurfaces,
  WorkspaceSurfaceProvider,
} from "@workspace/hooks/layout/surface";
import {
  createAppPane,
  createEditorPaneId,
  deriveOpenSessionIds,
  deriveReachablePaneIds,
  deriveVisibleWorkspacePanes,
  deriveWorkspaceRootPanes,
  INBOX_PANE,
  isEditorPane,
  MAX_WORKSPACE_PANES,
  type WorkspacePane,
} from "@workspace/model/panes";
import { machineFile } from "@files/model";
import { parseLayoutPrefs, resolveLayoutPrefs } from "@workspace/model/config/layoutPrefs";
import { useLayoutCookie } from "@workspace/hooks/layout/useLayoutCookie";
import { sessionMutations } from "@sessions/mutations";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";
import type { SessionsState } from "@sessions/model";
import { selectNonWorkerSessions, sessionQueries } from "@sessions/queries";
const Terminal = lazy(() =>
  import("@terminal/components/Terminal").then((m) => ({ default: m.Terminal })),
);

const searchSchema = z
  .object({
    sessions: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    apps: z.array(z.string()).optional(),
  })
  .transform(({ sessions = [], files = [], apps = [] }) => {
    const roots = deriveWorkspaceRootPanes(sessions, files, apps);
    const normalizedSessions = roots.flatMap((pane) =>
      pane.kind === "session" ? [pane.sessionId] : [],
    );
    const normalizedFiles = roots.flatMap((pane) =>
      pane.kind === "editor" ? [pane.file.path] : [],
    );
    const normalizedApps = roots.flatMap((pane) => (pane.kind === "app" ? [pane.appId] : []));
    return {
      sessions: normalizedSessions.length > 0 ? normalizedSessions : undefined,
      files: normalizedFiles.length > 0 ? normalizedFiles : undefined,
      apps: normalizedApps.length > 0 ? normalizedApps : undefined,
    };
  });

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(searchSchema),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueries.state());
    return loadLayoutPrefs();
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

type HyperLayoutState = Pick<HyperSessionState, "open" | "position">;

function selectSessionList(state: SessionsState) {
  return {
    sessions: selectNonWorkerSessions(state),
    worktreeSessionIds: Object.keys(state.worktrees),
  };
}

function restoreHyperSessionState(
  sessionId: string | undefined,
  layout: HyperLayoutState,
): HyperSessionState | null {
  return sessionId ? { sessionId, appIds: [], ...layout } : null;
}

function WorkspacePage() {
  const navigate = useNavigate();
  const selectedSessionIds = Route.useSearch({
    select: (search) => search.sessions ?? [],
    structuralSharing: true,
  });
  const targetSelectedSessionIds = useRouterState({
    select: (state) => state.location.search.sessions ?? [],
    structuralSharing: true,
  });
  const selectedAppIds = Route.useSearch({
    select: (search) => search.apps ?? [],
    structuralSharing: true,
  });
  const {
    sidebarWidth: initialSidebarWidth,
    terminalSize: initialTerminalSize,
    sidebarCollapsed: initialSidebarCollapsed,
    terminalOpen: initialTerminalOpen,
    appsExpanded: initialAppsExpanded,
    automationsExpanded: initialAutomationsExpanded,
    hyperOpen: initialHyperOpen,
    hyperPosition: initialHyperPosition,
    mobileInboxOpen: initialMobileInboxOpen,
  } = Route.useLoaderData();
  const { isMobile: isMobileLayout, hydrated } = useViewport();
  const [isMobileInboxOpen, setIsMobileInboxOpen] = useState(initialMobileInboxOpen);

  function updateSelectedSessionIds(
    nextSelectedSessionIds: string[],
    options?: { replaceWorkspace?: boolean },
  ) {
    void navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        sessions: nextSelectedSessionIds.length > 0 ? nextSelectedSessionIds : undefined,
        // A focus reset (single-click select, plain new, inbox) replaces the whole
        // workspace, so it drops open files and apps too; an augment preserves them.
        files: options?.replaceWorkspace ? undefined : prev.files,
        apps: options?.replaceWorkspace ? undefined : prev.apps,
      }),
    });
  }

  // Browser-opened files are machine paths in the URL, beside the selected
  // sessions, so they survive a reload and can be shared. Both derive into root
  // panes below.
  function openFile(path: string) {
    // Opening a file augments the workspace, so — like a modifier-click on a
    // session — it's ignored when the four-pane surface is full (which keeps the
    // URL within its cap); re-opening an already-open file just re-focuses it.
    if (!openFilePaths.includes(path) && openPanes.length >= MAX_WORKSPACE_PANES) return;
    void navigate({
      to: "/",
      search: (prev) => {
        const files = prev.files ?? [];
        return files.includes(path) ? prev : { ...prev, files: [...files, path] };
      },
      replace: true,
    });
    // The desktop grid shows the new file as a cell; the mobile pager has to be
    // slid over to the workspace track and paged to it.
    if (isMobileLayout) {
      setIsMobileInboxOpen(true);
      focusWorkspaceSurfacePane("main", createEditorPaneId(machineFile(path)));
    }
  }

  function closeFile(path: string) {
    void navigate({
      to: "/",
      search: (prev) => {
        const files = (prev.files ?? []).filter((open) => open !== path);
        return { ...prev, files: files.length > 0 ? files : undefined };
      },
      replace: true,
    });
  }

  function closeApp(appId: string) {
    void navigate({
      to: "/",
      search: (prev) => {
        const apps = (prev.apps ?? []).filter((open) => open !== appId);
        return { ...prev, apps: apps.length > 0 ? apps : undefined };
      },
      replace: true,
    });
  }

  const primarySelectedSessionId = selectedSessionIds[0];
  const panePublications = useSelector(workspaceSurfaces.main.panePublications);
  const hyperPanePublications = useSelector(workspaceSurfaces.hyper.panePublications);
  const openFilePaths = Route.useSearch({
    select: (search) => search.files ?? [],
    structuralSharing: true,
  });
  const rootPanes = deriveWorkspaceRootPanes(selectedSessionIds, openFilePaths, selectedAppIds);
  const rootEditorPaneIds = new Set(rootPanes.filter(isEditorPane).map((pane) => pane.id));
  const resolvePaneClose = (pane: WorkspacePane): (() => void) | undefined => {
    if (isEditorPane(pane) && rootEditorPaneIds.has(pane.id)) {
      return () => closeFile(pane.file.path);
    }
    if (pane.kind === "app") return () => closeApp(pane.appId);
    return undefined;
  };
  const reachablePaneIds = deriveReachablePaneIds(rootPanes, panePublications);
  const openPanes = deriveVisibleWorkspacePanes({
    rootPanes,
    panePublications,
  });
  const openSessionIds = deriveOpenSessionIds(openPanes);
  const selectedSessionIdSet = new Set(selectedSessionIds);
  const sidebarOpenSessionIds = [
    ...new Set([
      ...openSessionIds.filter((sessionId) => !selectedSessionIdSet.has(sessionId)),
      ...targetSelectedSessionIds,
    ]),
  ];

  const showExternalSessions = useWorkspaceSelector(
    (workspace) => workspace.settings.showExternalSessions,
  );
  const updateSetting = useUpdateWorkspaceSetting();

  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [terminalSize, setTerminalSize] = useState(initialTerminalSize);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(initialSidebarCollapsed);

  // Terminal state - synced with cookie (SSR-safe)
  const [isTerminalOpen, setIsTerminalOpen] = useState(initialTerminalOpen);
  const [isAppsExpanded, setIsAppsExpanded] = useState(initialAppsExpanded);
  const [isAutomationsExpanded, setIsAutomationsExpanded] = useState(initialAutomationsExpanded);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const shouldRenderMobileTerminalShell = import.meta.env.SSR
    ? initialTerminalOpen
    : isTerminalOpen;

  const { data: sessionList, isLoading: isSessionsLoading } = useQuery({
    ...sessionQueries.state(),
    select: selectSessionList,
  });
  const sessions = sessionList?.sessions;
  const worktreeSessionIds = sessionList?.worktreeSessionIds ?? [];
  const { apps, automationSessionIds, hyperSessionIds, inboxSessionIds } = useWorkspaceSelector(
    (workspace) => ({
      apps: workspace.apps,
      automationSessionIds: workspace.automations.map((automation) => automation.id),
      hyperSessionIds: workspace.hyperSessionIds,
      inboxSessionIds: workspace.inboxEntries.map((entry) => entry.id),
    }),
  );
  useWorkspaceSync();
  const { listedDrafts, isDraft, createDraft } = useDrafts({
    hiddenSessionIds: hyperSessionIds,
  });

  const managedSessionIds = new Set([
    ...automationSessionIds,
    ...inboxSessionIds,
    ...hyperSessionIds,
  ]);
  function handleCloseVisibleSession(sessionId: string) {
    if (!selectedSessionIds.includes(sessionId)) return;
    updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionId));
  }

  function handleSessionSelect(sessionId: string, toggleInWorkspace = false) {
    if (!toggleInWorkspace || isMobileLayout) {
      if (isMobileLayout) setIsMobileInboxOpen(false);
      updateSelectedSessionIds([sessionId], { replaceWorkspace: true });
      return;
    }

    if (selectedSessionIds.includes(sessionId)) {
      handleCloseVisibleSession(sessionId);
      return;
    }

    if (openPanes.length >= MAX_WORKSPACE_PANES && !openSessionIds.includes(sessionId)) return;
    updateSelectedSessionIds([...selectedSessionIds, sessionId]);
  }

  function handleAppOpen(appId: string, toggleInWorkspace = false) {
    if (!toggleInWorkspace || isMobileLayout) {
      if (isMobileLayout) setIsMobileInboxOpen(false);
      void navigate({
        to: "/",
        search: (prev) => ({
          ...prev,
          sessions: undefined,
          files: undefined,
          apps: [appId],
        }),
      });
      return;
    }

    if (selectedAppIds.includes(appId)) {
      closeApp(appId);
      return;
    }
    if (openPanes.length >= MAX_WORKSPACE_PANES) return;
    void navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        apps: [...(prev.apps ?? []), appId],
      }),
    });
  }

  // Create a durable draft, optionally with an initial artifact or alongside the workspace.
  const handleCreateSession: SidebarProps["onCreateSession"] = (options = {}) => {
    const id = createDraft(options.artifact ? { artifact: options.artifact } : undefined);
    if (isMobileLayout) setIsMobileInboxOpen(false);

    if (options.addToWorkspace && openPanes.length > 0 && openPanes.length < MAX_WORKSPACE_PANES) {
      // Add to the workspace.
      updateSelectedSessionIds([...selectedSessionIds, id]);
    } else {
      // Replace current view
      updateSelectedSessionIds([id], { replaceWorkspace: true });
    }
  };

  // Keep URL session IDs aligned with available sessions.
  // This prevents stale open panes when another client deletes a session.
  useEffect(() => {
    if (isSessionsLoading) return;
    if (selectedSessionIds.length === 0) return;

    const availableSessionIds = new Set(sessions?.map((session) => session.sessionId) ?? []);
    for (const draft of listedDrafts) availableSessionIds.add(draft.sessionId);
    for (const sessionId of hyperSessionIds) availableSessionIds.add(sessionId);
    for (const sessionId of automationSessionIds) availableSessionIds.add(sessionId);

    const validSessionIds = selectedSessionIds.filter((sessionId) =>
      availableSessionIds.has(sessionId),
    );

    if (validSessionIds.length === selectedSessionIds.length) return;

    void navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        sessions: validSessionIds.length > 0 ? validSessionIds : undefined,
      }),
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

  // Saved apps are durable URL roots, so a deletion from another client must
  // remove only the stale app root without disturbing adjacent panes.
  useEffect(() => {
    if (selectedAppIds.length === 0) return;
    const availableAppIds = new Set(apps.map((app) => app.id));
    const validAppIds = selectedAppIds.filter((appId) => availableAppIds.has(appId));
    if (validAppIds.length === selectedAppIds.length) return;

    void navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        apps: validAppIds.length > 0 ? validAppIds : undefined,
      }),
      replace: true,
    });
  }, [apps, navigate, selectedAppIds]);

  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [isTerminalDragging, setIsTerminalDragging] = useState(false);
  const terminalSizeRef = useRef(terminalSize);
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
    terminalSizeRef.current = terminalSize;
  }, [terminalSize]);

  useLayoutCookie("sidebarCollapsed", isSidebarCollapsed);
  useLayoutCookie("sidebarWidth", sidebarWidth);
  useLayoutCookie("terminalOpen", isTerminalOpen);
  useLayoutCookie("terminalSize", terminalSize);
  useLayoutCookie("appsExpanded", isAppsExpanded);
  useLayoutCookie("automationsExpanded", isAutomationsExpanded);
  useLayoutCookie("mobileInboxOpen", hydrated && isMobileLayout ? isMobileInboxOpen : undefined);

  function handleTerminalResize(size: number) {
    if (size > 0) {
      terminalSizeRef.current = size;
      if (!isTerminalDraggingRef.current) {
        setTerminalSize(size);
      }
    }
  }

  function handleTerminalDragging(dragging: boolean) {
    isTerminalDraggingRef.current = dragging;
    setIsTerminalDragging(dragging);
    if (!dragging) {
      setTerminalSize(terminalSizeRef.current);
    }
  }

  const toggleSidebar = () => setIsSidebarCollapsed((collapsed) => !collapsed);

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
    setIsTerminalOpen(false);
  }

  const deferredFilter = useDeferredValue(filter);

  // Managed sessions are presented by their automation, inbox, hyper, or parent surface.
  const listedSessions = (sessions ?? [])
    .filter((session) => !managedSessionIds.has(session.sessionId) && !isDraft(session.sessionId))
    .sort((left, right) => right.modifiedTime.getTime() - left.modifiedTime.getTime())
    .slice(0, 50);

  useWarmSessionSnapshots();

  let filteredSessions = listedSessions;

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

  function handleSessionDelete(sessionIdToDelete: string) {
    if (selectedSessionIds.includes(sessionIdToDelete)) {
      if (isMobileLayout) setIsMobileInboxOpen(false);
      updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionIdToDelete));
    }
  }

  const renameTargetSession =
    sessions?.find((session) => session.sessionId === renameTargetId) ?? null;

  function handleSessionRename(sessionId: string) {
    setRenameTargetId(sessionId);
  }

  function handleRenameDialogOpenChange(open: boolean) {
    if (!open) setRenameTargetId(null);
  }

  function openSessionInWorkspace(sessionId: string) {
    if (!selectedSessionIds.includes(sessionId)) {
      const nextSelectedSessionIds =
        openPanes.length >= MAX_WORKSPACE_PANES && !openSessionIds.includes(sessionId)
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
    updateSelectedSessionIds([getOrCreateHyperSessionId()], { replaceWorkspace: true });
  }

  // "Open" is viewport-relative: the deck is open on desktop; on mobile the hyper
  // session is open when it's the one in view. The sidebar dot is its inverse.
  const isHyperOpen = isMobileLayout
    ? hyperSessionId !== undefined && primarySelectedSessionId === hyperSessionId
    : hyper.isOpen;

  function handleAppOpenInHyper(appId: string) {
    if (isMobileLayout) {
      handleAppOpen(appId);
      return;
    }
    hyper.openApp(appId);
  }

  function openAppInMainSurface(appId: string) {
    if (!selectedAppIds.includes(appId)) {
      void navigate({
        to: "/",
        search: (prev) =>
          openPanes.length >= MAX_WORKSPACE_PANES
            ? { ...prev, sessions: undefined, files: undefined, apps: [appId] }
            : { ...prev, apps: [...(prev.apps ?? []), appId] },
      });
    }
    focusWorkspaceSurfacePane("main", createAppPane(appId).id);
  }

  // Each surface prunes its own browser-local pane graph from its own roots.
  useEffect(() => {
    workspaceSurfaces.main.panePublications.actions.prunePanePublishers(new Set(reachablePaneIds));
  }, [panePublications, reachablePaneIds]);

  useEffect(() => {
    const hyperReachablePaneIds = hyperSession
      ? deriveReachablePaneIds(
          deriveWorkspaceRootPanes([hyperSession.sessionId], [], hyperSession.appIds),
          hyperPanePublications,
        )
      : [];
    workspaceSurfaces.hyper.panePublications.actions.prunePanePublishers(
      new Set(hyperReachablePaneIds),
    );
  }, [hyperPanePublications, hyperSession]);

  const hasWorkspaceRoot =
    selectedSessionIds.length > 0 || selectedAppIds.length > 0 || openFilePaths.length > 0;
  const isInboxOpen = !hasWorkspaceRoot && (!isMobileLayout || isMobileInboxOpen);

  function handleOpenInbox() {
    if (isMobileLayout) setIsMobileInboxOpen(true);
    if (hasWorkspaceRoot) {
      updateSelectedSessionIds([], { replaceWorkspace: true });
    }
  }

  function handleMobileWorkspaceBack() {
    workspaceSurfaces.main.panePublications.actions.clearLinkedPanes(INBOX_PANE.id);
    setIsMobileInboxOpen(false);
    if (hasWorkspaceRoot) {
      updateSelectedSessionIds([], { replaceWorkspace: true });
    }
  }

  const baseMobileView = hasWorkspaceRoot
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

  const terminalBody = (
    <ClientOnly fallback={terminalBodySkeleton}>
      <Suspense fallback={terminalBodySkeleton}>
        <Terminal onClose={handleTerminalClose} />
      </Suspense>
    </ClientOnly>
  );

  // Shared sidebar props for both mobile and desktop
  const sidebarProps = {
    filter,
    onFilterChange: setFilter,
    showExternalSessions,
    onShowExternalSessionsChange: (value) => updateSetting("showExternalSessions", value),
    sessions: filteredSessions,
    isSessionsLoading,
    onSessionSelect: handleSessionSelect,
    onSessionRename: handleSessionRename,
    onSessionDelete: handleSessionDelete,
    openSessionIds: sidebarOpenSessionIds,
    worktreeSessionIds,
    emptyMessage: deferredFilter ? "No sessions match your filter" : undefined,
    draftSessions: listedDrafts,
    isAppsExpanded,
    onAppsExpandedChange: setIsAppsExpanded,
    isAutomationsExpanded,
    onAutomationsExpandedChange: setIsAutomationsExpanded,
    onCreateSession: handleCreateSession,
    openAppIds: selectedAppIds,
    onAppOpen: handleAppOpen,
    onAppOpenInHyper: handleAppOpenInHyper,
    onToggleHyper: toggleHyper,
    isHyperOpen,
    onOpenInbox: handleOpenInbox,
    isInboxOpen,
    onOpenFile: openFile,
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
              resolvePaneClose={resolvePaneClose}
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
            <TerminalShell onClose={handleTerminalClose}>
              {isMobileLayout ? terminalBody : terminalBodySkeleton}
            </TerminalShell>
          )}
        </div>
      </div>
    </div>
  );

  // Desktop layout - fixed-width sidebar beside resizable panes
  const desktopLayout = (
    <div className="h-full hidden md:block">
      <div className="flex h-full">
        <Sidebar
          {...sidebarProps}
          collapsible={{
            expandedWidth: sidebarWidth,
            collapsed: isSidebarCollapsed,
            onExpandedWidthChange: setSidebarWidth,
            onCollapsedChange: setIsSidebarCollapsed,
          }}
        />

        <div className="min-w-0 flex-1">
          <ResizablePanelGroup direction="vertical" className="h-full">
            {/* Main workspace */}
            <ResizablePanel order={1} defaultSize={isTerminalOpen ? 100 - terminalSize : 100}>
              <div className="h-full overflow-hidden relative">
                <WorkspaceGrid
                  panes={openPanes}
                  onCloseSession={handleCloseVisibleSession}
                  resolvePaneClose={resolvePaneClose}
                />
              </div>
            </ResizablePanel>

            {/* Terminal drawer (collapsible from bottom) */}
            <ResizableHandle
              disabled={!isTerminalOpen}
              onDragging={handleTerminalDragging}
              className={!isTerminalOpen ? "hidden" : ""}
            />
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
              className={
                !isTerminalDragging ? "transition-[flex-grow] duration-300 ease-layout" : ""
              }
            >
              {isTerminalMounted && (
                <div className="h-full border-t">
                  <TerminalShell onClose={handleTerminalClose}>
                    {!isMobileLayout ? terminalBody : terminalBodySkeleton}
                  </TerminalShell>
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      {hyperSession?.open && (
        <HyperSession
          state={hyperSession}
          onPositionChange={hyper.setPosition}
          onRemove={hyper.removeSurface}
          onMinimize={hyper.toggle}
          onPromote={hyper.promote}
          onOpenApp={hyper.openApp}
          onCloseApp={hyper.closeApp}
        />
      )}
    </div>
  );

  return (
    <>
      <WorkspaceSurfaceProvider surface="main" panes={openPanes} onOpenApp={openAppInMainSurface}>
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
      {renameTargetSession && (
        <NameDialog
          key={renameTargetSession.sessionId}
          name={renameTargetSession.summary ?? ""}
          title="Rename session"
          description="Change how this session appears in the session list."
          mutation={sessionMutations.renameSession(renameTargetSession.sessionId)}
          onOpenChange={handleRenameDialogOpenChange}
        />
      )}
    </>
  );
}
