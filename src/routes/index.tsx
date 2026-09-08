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
  MAX_WORKSPACE_PANES,
  type WorkspacePane,
} from "@workspace/model/panes";
import {
  machineFile,
  workspaceFileId,
  workspaceFileSchema,
  type WorkspaceFile,
} from "@files/model";
import {
  readWorkspaceLayout,
  serializeWorkspaceLayout,
  type SidebarPanels,
} from "@workspace/model/config/layoutPrefs";
import { sessionMutations } from "@sessions/mutations";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";
import type { SessionsState } from "@sessions/model";
import { selectNonWorkerSessions, sessionQueries } from "@sessions/queries";
import { channelQueries } from "@channels/queries";
import { agentQueries } from "@agents/queries";
const Terminal = lazy(() =>
  import("@terminal/components/Terminal").then((m) => ({ default: m.Terminal })),
);

const searchSchema = z
  .object({
    sessions: z.array(z.string()).optional(),
    files: z.array(workspaceFileSchema).optional(),
    apps: z.array(z.string()).optional(),
    channels: z.array(z.string()).optional(),
  })
  .transform(({ sessions = [], files = [], apps = [], channels = [] }) => {
    const roots = deriveWorkspaceRootPanes(sessions, files, apps, channels);
    const normalizedSessions = roots.flatMap((pane) =>
      pane.kind === "session" ? [pane.sessionId] : [],
    );
    const normalizedFiles = roots.flatMap((pane) => (pane.kind === "editor" ? [pane.file] : []));
    const normalizedApps = roots.flatMap((pane) => (pane.kind === "app" ? [pane.appId] : []));
    const normalizedChannels = roots.flatMap((pane) =>
      pane.kind === "channel" ? [pane.channelId] : [],
    );
    return {
      sessions: normalizedSessions.length > 0 ? normalizedSessions : undefined,
      files: normalizedFiles.length > 0 ? normalizedFiles : undefined,
      apps: normalizedApps.length > 0 ? normalizedApps : undefined,
      channels: normalizedChannels.length > 0 ? normalizedChannels : undefined,
    };
  });

type WorkspaceSearch = z.output<typeof searchSchema>;

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(searchSchema),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(sessionQueries.state()),
      context.queryClient.ensureQueryData(channelQueries.list()),
      context.queryClient.ensureQueryData(agentQueries.list()),
    ]);
    return loadWorkspaceLayout();
  },
  component: WorkspacePage,
});

const readCookieHeader = createIsomorphicFn()
  .client(() => document.cookie)
  .server(async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("cookie") ?? getRequestHeader("Cookie");
  });

async function loadWorkspaceLayout() {
  const cookieHeader = await readCookieHeader();
  return readWorkspaceLayout(cookieHeader);
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
  const selectedChannelIds = Route.useSearch({
    select: (search) => search.channels ?? [],
    structuralSharing: true,
  });
  const openFiles = Route.useSearch({
    select: (search) => search.files ?? [],
    structuralSharing: true,
  });
  const initialLayout = Route.useLoaderData();
  const { isMobile: isMobileLayout, hydrated } = useViewport();

  function updateWorkspaceRoot<Key extends keyof WorkspaceSearch>(
    key: Key,
    update: (current: NonNullable<WorkspaceSearch[Key]>) => NonNullable<WorkspaceSearch[Key]>,
    options?: { replaceWorkspace?: boolean; replaceHistory?: boolean },
  ) {
    return navigate({
      to: "/",
      search: (prev) => {
        const current = (prev[key] ?? []) as NonNullable<WorkspaceSearch[Key]>;
        const next = update(current);
        const search = options?.replaceWorkspace
          ? {
              ...prev,
              sessions: undefined,
              files: undefined,
              apps: undefined,
              channels: undefined,
            }
          : prev;
        return { ...search, [key]: next.length > 0 ? next : undefined };
      },
      replace: options?.replaceHistory,
    });
  }

  function updateSelectedSessionIds(
    nextSelectedSessionIds: string[],
    options?: { replaceWorkspace?: boolean },
  ) {
    // A focus reset replaces the whole workspace; an augment preserves its other roots.
    void updateWorkspaceRoot("sessions", () => nextSelectedSessionIds, options);
  }

  // Browser-opened files live in the URL beside the selected sessions, so they
  // survive a reload and can be shared. Both derive into root panes below.
  function openWorkspaceFile(file: WorkspaceFile) {
    // Opening a file augments the workspace, so — like a modifier-click on a
    // session — it's ignored when the four-pane surface is full (which keeps the
    // URL within its cap); re-opening an already-open file is idempotent.
    const id = workspaceFileId(file);
    if (
      !openFiles.some((open) => workspaceFileId(open) === id) &&
      openPanes.length >= MAX_WORKSPACE_PANES
    )
      return;
    const navigation = updateWorkspaceRoot(
      "files",
      (files) => (files.some((open) => workspaceFileId(open) === id) ? files : [...files, file]),
      { replaceHistory: true },
    );
    // The desktop grid shows the new file as a cell; the mobile pager has to be
    // slid over to the workspace track and paged to it.
    if (isMobileLayout) {
      void navigation.then(() => focusWorkspaceSurfacePane("main", createEditorPaneId(file)));
    }
  }

  function openFile(path: string) {
    openWorkspaceFile(machineFile(path));
  }

  function closeWorkspaceRoot(key: "apps" | "channels", id: string) {
    void updateWorkspaceRoot(key, (current) => current.filter((open) => open !== id), {
      replaceHistory: true,
    });
  }

  function closeFile(file: WorkspaceFile) {
    const id = workspaceFileId(file);
    void updateWorkspaceRoot(
      "files",
      (current) => current.filter((open) => workspaceFileId(open) !== id),
      { replaceHistory: true },
    );
  }

  function toggleFile(file: WorkspaceFile) {
    if (openFiles.some((open) => workspaceFileId(open) === workspaceFileId(file))) {
      closeFile(file);
    } else {
      openWorkspaceFile(file);
    }
  }

  const primarySelectedSessionId = selectedSessionIds[0];
  const panePublications = useSelector(workspaceSurfaces.main.panePublications);
  const hyperPanePublications = useSelector(workspaceSurfaces.hyper.panePublications);
  const rootPanes = deriveWorkspaceRootPanes(
    selectedSessionIds,
    openFiles,
    selectedAppIds,
    selectedChannelIds,
  );
  const rootPaneIds = new Set(rootPanes.map((pane) => pane.id));
  const resolvePaneClose = (pane: WorkspacePane): (() => void) | undefined => {
    if (!rootPaneIds.has(pane.id)) return undefined;
    switch (pane.kind) {
      case "session":
        return () => handleCloseVisibleSession(pane.sessionId);
      case "editor":
        return () => closeFile(pane.file);
      case "app":
        return () => closeWorkspaceRoot("apps", pane.appId);
      case "channel":
        return () => closeWorkspaceRoot("channels", pane.channelId);
      case "inbox":
      case "canvas":
        return undefined;
    }
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

  // Layout state is restored from and persisted to the workspace layout cookie.
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.sidebarWidth);
  const [terminalSize, setTerminalSize] = useState(initialLayout.terminalSize);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(initialLayout.sidebarCollapsed);
  const [isTerminalOpen, setIsTerminalOpen] = useState(initialLayout.terminalOpen);
  const [sidebarPanels, setSidebarPanels] = useState<SidebarPanels>(initialLayout.panels);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const shouldRenderMobileTerminalShell = import.meta.env.SSR
    ? initialLayout.terminalOpen
    : isTerminalOpen;

  const { data: sessionList, isLoading: isSessionsLoading } = useQuery({
    ...sessionQueries.state(),
    select: selectSessionList,
  });
  const sessions = sessionList?.sessions;
  const worktreeSessionIds = sessionList?.worktreeSessionIds ?? [];
  const { data: channels = [] } = useQuery(channelQueries.list());
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

  function handleWorkspaceRootOpen(
    key: "apps" | "channels",
    id: string,
    selectedIds: string[],
    toggleInWorkspace = false,
  ) {
    if (!toggleInWorkspace || isMobileLayout) {
      void updateWorkspaceRoot(key, () => [id], { replaceWorkspace: true });
      return;
    }

    if (selectedIds.includes(id)) {
      closeWorkspaceRoot(key, id);
      return;
    }
    if (openPanes.length >= MAX_WORKSPACE_PANES) return;
    void updateWorkspaceRoot(key, (current) => [...current, id]);
  }

  function handleAppOpen(appId: string, toggleInWorkspace = false) {
    handleWorkspaceRootOpen("apps", appId, selectedAppIds, toggleInWorkspace);
  }

  function handleChannelOpen(channelId: string, toggleInWorkspace = false) {
    handleWorkspaceRootOpen("channels", channelId, selectedChannelIds, toggleInWorkspace);
  }

  // Create a durable draft, optionally with an initial artifact or alongside the workspace.
  const handleCreateSession: SidebarProps["onCreateSession"] = (options = {}) => {
    const id = createDraft(options.artifact ? { artifact: options.artifact } : undefined);

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

  // Channels are durable URL roots, parallel to sessions and apps.
  useEffect(() => {
    if (selectedChannelIds.length === 0) return;
    const availableChannelIds = new Set(channels.map((channel) => channel.id));
    const validChannelIds = selectedChannelIds.filter((channelId) =>
      availableChannelIds.has(channelId),
    );
    if (validChannelIds.length === selectedChannelIds.length) return;

    void navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        channels: validChannelIds.length > 0 ? validChannelIds : undefined,
      }),
      replace: true,
    });
  }, [channels, navigate, selectedChannelIds]);

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
    position: initialLayout.hyperPosition,
    open: initialLayout.hyperOpen,
  });

  const hyper = useHyperSession({
    initialState: restoredHyperSession,
    hyperSessionId,
    createDraft,
    openSessionInWorkspace,
  });
  const hyperSession = hyper.state;
  const { getOrCreateSessionId: getOrCreateHyperSessionId, toggle: toggleHyperSession } = hyper;

  const layoutCookie = serializeWorkspaceLayout({
    sidebarWidth,
    terminalSize,
    sidebarCollapsed: isSidebarCollapsed,
    terminalOpen: isTerminalOpen,
    panels: sidebarPanels,
    hyperOpen: hyper.isOpen,
    hyperPosition: hyperSession?.position ?? initialLayout.hyperPosition,
  });
  useEffect(() => {
    document.cookie = layoutCookie;
  }, [layoutCookie]);

  // The hyper session has no floating deck on mobile; opening it there means
  // selecting it into the main view — the same URL navigation any list session
  // uses — so a reload restores it through the existing selected-session SSR.
  function toggleHyper() {
    if (!isMobileLayout) {
      toggleHyperSession();
      return;
    }
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
      void updateWorkspaceRoot(
        "apps",
        (current) => (openPanes.length >= MAX_WORKSPACE_PANES ? [appId] : [...current, appId]),
        { replaceWorkspace: openPanes.length >= MAX_WORKSPACE_PANES },
      );
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
    selectedSessionIds.length > 0 ||
    selectedAppIds.length > 0 ||
    selectedChannelIds.length > 0 ||
    openFiles.length > 0;
  const isInboxOpen = !hasWorkspaceRoot && (!isMobileLayout || isSidebarCollapsed);

  function handleOpenInbox() {
    if (isMobileLayout) setIsSidebarCollapsed(true);
    if (hasWorkspaceRoot) {
      updateSelectedSessionIds([], { replaceWorkspace: true });
    }
  }

  function handleMobileWorkspaceBack() {
    workspaceSurfaces.main.panePublications.actions.clearLinkedPanes(INBOX_PANE.id);
    setIsSidebarCollapsed(false);
    if (hasWorkspaceRoot) {
      updateSelectedSessionIds([], { replaceWorkspace: true });
    }
  }

  const baseMobileView = hasWorkspaceRoot || isSidebarCollapsed ? "workspace" : "sidebar";
  const mobileView = isTerminalOpen ? "terminal" : baseMobileView;
  const mobileTrackIndex = baseMobileView === "sidebar" ? 0 : 1;
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

  function handlePanelExpanded(panel: keyof SidebarPanels, expanded: boolean) {
    setSidebarPanels((current) =>
      isMobileLayout
        ? expanded
          ? { [panel]: true }
          : {}
        : { ...current, [panel]: expanded ? true : undefined },
    );
  }

  const mobileSidebarPanels: SidebarPanels = sidebarPanels.channels
    ? { channels: true }
    : sidebarPanels.apps
      ? { apps: true }
      : sidebarPanels.automations
        ? { automations: true }
        : {};

  // Shared sidebar props for both mobile and desktop.
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
    panels: sidebarPanels,
    onPanelExpanded: handlePanelExpanded,
    onCreateSession: handleCreateSession,
    openAppIds: selectedAppIds,
    onAppOpen: handleAppOpen,
    onAppOpenInHyper: handleAppOpenInHyper,
    openChannelIds: selectedChannelIds,
    onChannelOpen: handleChannelOpen,
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
    <div className="relative h-full overflow-clip md:hidden">
      {/* Slide track - shifts between sidebar and workspace */}
      <div
        className={`flex h-full w-[200%] ${hydrated ? "transition-transform duration-300 ease-in-out" : ""}`}
        style={{ transform: `translateX(-${mobileTrackIndex * 50}%)` }}
      >
        {/* Sidebar */}
        <div className="h-full w-1/2 shrink-0">
          <Sidebar {...sidebarProps} panels={mobileSidebarPanels} />
        </div>

        {/* Workspace View */}
        <div className="h-full w-1/2 shrink-0">
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
                <WorkspaceGrid panes={openPanes} resolvePaneClose={resolvePaneClose} />
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
      <WorkspaceSurfaceProvider
        surface="main"
        panes={openPanes}
        onOpenApp={openAppInMainSurface}
        onOpenFile={openFile}
        onToggleFile={toggleFile}
      >
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
