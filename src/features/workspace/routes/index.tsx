import { useHotkey } from "@tanstack/react-hotkeys";
import { createFileRoute, useNavigate, useRouterState, ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { useState, useEffect, useDeferredValue, lazy, Suspense } from "react";
import { useSelector } from "@tanstack/react-store";
import { z } from "zod";
import { useSessions } from "@sessions/useSessions";
import { useHyperSession, type HyperSessionState } from "@workspace/hooks/layout/useHyperSession";
import { useWarmSessionSnapshots } from "@sessions/useWarmSessionSnapshots";
import { useWorkspaceSync } from "@workspace/hooks/useWorkspaceSync";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useViewport } from "@/shared/hooks/useViewport";
import { NameDialog } from "@/shared/sidebar/NameDialog";
import type { SidebarProps } from "@workspace/components/sidebar/Sidebar";
import {
  WorkspaceLayout,
  type WorkspaceLayoutProps,
} from "@workspace/components/layout/WorkspaceLayout";
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
import {
  filterSessionList,
  type SessionFilters,
} from "@sessions/components/sidebar/sessionFilters";
import { sessionQueries } from "@sessions/queries";
import { providerQueries } from "@providers/queries";
import { useHasModels } from "@providers/useModels";
import { channelQueries } from "@channels/queries";
const Terminal = lazy(() =>
  import("@terminal/components/Terminal").then((m) => ({
    default: m.Terminal,
  })),
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
      context.queryClient.ensureQueryData(providerQueries.catalog()),
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

function restoreHyperSessionState(
  sessionId: string | undefined,
  layout: HyperLayoutState,
): HyperSessionState | null {
  return sessionId ? { sessionId, appIds: [], ...layout } : null;
}

function WorkspacePage() {
  const navigate = useNavigate();
  const { workspaceRevision } = Route.useRouteContext();
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
  const focusedPaneId = useSelector(workspaceSurfaces.main.focusedPaneAtom);
  const openPanes = deriveVisibleWorkspacePanes({
    rootPanes,
    panePublications,
    focusedPaneId,
  });
  const openSessionIds = deriveOpenSessionIds(openPanes);
  const selectedSessionIdSet = new Set(selectedSessionIds);
  const sidebarOpenSessionIds = [
    ...new Set([
      ...openSessionIds.filter((sessionId) => !selectedSessionIdSet.has(sessionId)),
      ...targetSelectedSessionIds,
    ]),
  ];

  const disabledProviders = useWorkspaceSelector(
    (workspace) => workspace.settings.disabledProviders,
  );

  // Layout state is restored from and persisted to the workspace layout cookie.
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.sidebarWidth);
  const [terminalSize, setTerminalSize] = useState(initialLayout.terminalSize);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(initialLayout.sidebarCollapsed);
  const [isTerminalOpen, setIsTerminalOpen] = useState(initialLayout.terminalOpen);
  const [sidebarPanels, setSidebarPanels] = useState<SidebarPanels>(initialLayout.panels);

  const hasModels = useHasModels();
  const { data: channelList } = useQuery(channelQueries.list());
  const channels = channelList?.channels;
  const { apps, automations, hyperSessionIds, inboxSessionIds, pinnedSessionIds } =
    useWorkspaceSelector((workspace) => ({
      apps: workspace.apps,
      automations: workspace.automations,
      hyperSessionIds: workspace.hyperSessionIds,
      inboxSessionIds: workspace.inboxEntries.map((entry) => entry.id),
      pinnedSessionIds: workspace.settings.pinnedSessionIds,
    }));
  useWorkspaceSync(workspaceRevision);
  const {
    sessions,
    isLoading: isSessionsLoading,
    worktreeSessionIds,
    createSession,
  } = useSessions({
    hiddenSessionIds: [
      ...hyperSessionIds,
      ...automations.map((automation) => automation.id),
      ...inboxSessionIds,
    ],
  });

  const managedSessionIds = new Set([
    ...automations.map((automation) => automation.id),
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

  // Create a draft session, optionally with an initial artifact or alongside the workspace.
  const handleCreateSession: SidebarProps["onCreateSession"] = (options = {}) => {
    const id = createSession(options.artifact ? { artifact: options.artifact } : undefined);

    if (options.addToWorkspace && openPanes.length > 0 && openPanes.length < MAX_WORKSPACE_PANES) {
      // Add to the workspace.
      updateSelectedSessionIds([...selectedSessionIds, id]);
    } else {
      // Replace current view
      updateSelectedSessionIds([id], { replaceWorkspace: true });
    }
  };

  // Close panes when their session leaves the catalog, including an older session losing its pin.
  useEffect(() => {
    if (isSessionsLoading) return;
    if (selectedSessionIds.length === 0) return;

    const availableSessionIds = new Set(sessions?.map((session) => session.id) ?? []);
    for (const automation of automations) {
      if (!disabledProviders.includes(automation.model.provider))
        availableSessionIds.add(automation.id);
    }

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
  }, [automations, disabledProviders, isSessionsLoading, navigate, selectedSessionIds, sessions]);

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
    if (!channels || selectedChannelIds.length === 0) return;
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
  const [filter, setFilter] = useState<SessionFilters>({
    query: "",
    hiddenProviders: [],
    showExternalSessions: true,
  });
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
    enabled: hasModels,
    requireReset: true,
  });
  useHotkey("Control+`", toggleTerminal, { requireReset: true });

  function handleTerminalClose() {
    setIsTerminalOpen(false);
  }

  const deferredFilter = useDeferredValue(filter.query);

  // Managed sessions are presented by their automation, inbox, hyper, or parent surface.
  const listedSessions = (sessions ?? []).filter((session) => !managedSessionIds.has(session.id));

  useWarmSessionSnapshots();

  const filteredSessions = filterSessionList(
    listedSessions,
    {
      ...filter,
      hiddenProviders: [...filter.hiddenProviders, ...disabledProviders],
      query: deferredFilter,
    },
    pinnedSessionIds,
  );

  function handleSessionDelete(sessionIdToDelete: string) {
    if (selectedSessionIds.includes(sessionIdToDelete)) {
      updateSelectedSessionIds(selectedSessionIds.filter((id) => id !== sessionIdToDelete));
    }
  }

  const renameTargetSession = sessions?.find((session) => session.id === renameTargetId) ?? null;

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

  const hyperSessionId = hyperSessionIds.find((id) =>
    sessions?.some((session) => session.id === id),
  );
  const restoredHyperSession = restoreHyperSessionState(hyperSessionId, {
    position: initialLayout.hyperPosition,
    open: initialLayout.hyperOpen,
  });

  const hyper = useHyperSession({
    initialState: restoredHyperSession,
    hyperSessionId,
    createSession,
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
    updateSelectedSessionIds([getOrCreateHyperSessionId()], {
      replaceWorkspace: true,
    });
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

  const isMobileWorkspaceVisible = hasWorkspaceRoot || isSidebarCollapsed;
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

  // Shared sidebar props for both mobile and desktop.
  const sidebarProps = {
    filter,
    onFilterChange: setFilter,
    sessions: filteredSessions,
    isSessionsLoading,
    onSessionSelect: handleSessionSelect,
    onSessionRename: handleSessionRename,
    onSessionDelete: handleSessionDelete,
    openSessionIds: sidebarOpenSessionIds,
    worktreeSessionIds,
    emptyMessage:
      deferredFilter || filter.hiddenProviders.length || !filter.showExternalSessions
        ? "No sessions match your filters"
        : undefined,
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

  const mobileLayoutProps = {
    sidebar: sidebarProps,
    workspace: {
      visible: isMobileWorkspaceVisible,
      panes: openPanes,
      primaryPaneId: rootPanes[0].id,
      onBack: handleMobileWorkspaceBack,
      resolvePaneClose,
    },
    terminal: {
      open: isTerminalOpen,
      body: isMobileLayout ? terminalBody : terminalBodySkeleton,
      onClose: handleTerminalClose,
    },
  } satisfies WorkspaceLayoutProps["mobile"];

  const desktopLayoutProps = {
    sidebar: {
      ...sidebarProps,
      collapsible: {
        expandedWidth: sidebarWidth,
        collapsed: isSidebarCollapsed,
        onExpandedWidthChange: setSidebarWidth,
        onCollapsedChange: setIsSidebarCollapsed,
      },
    },
    workspace: { panes: openPanes, resolvePaneClose },
    terminal: {
      open: isTerminalOpen,
      size: terminalSize,
      body: !isMobileLayout ? terminalBody : terminalBodySkeleton,
      onOpenChange: setIsTerminalOpen,
      onSizeChange: setTerminalSize,
    },
    hyper: hyperSession?.open
      ? {
          state: hyperSession,
          onPositionChange: hyper.setPosition,
          onRemove: hyper.removeSurface,
          onMinimize: hyper.toggle,
          onPromote: hyper.promote,
          onOpenApp: hyper.openApp,
          onCloseApp: hyper.closeApp,
        }
      : null,
  } satisfies WorkspaceLayoutProps["desktop"];

  return (
    <>
      <WorkspaceSurfaceProvider
        surface="main"
        panes={openPanes}
        onOpenApp={openAppInMainSurface}
        onOpenFile={openFile}
        onToggleFile={toggleFile}
      >
        <WorkspaceLayout
          hydrated={hydrated}
          isMobile={isMobileLayout}
          mobile={mobileLayoutProps}
          desktop={desktopLayoutProps}
        />
      </WorkspaceSurfaceProvider>
      {renameTargetSession && (
        <NameDialog
          key={renameTargetSession.id}
          name={renameTargetSession.title ?? ""}
          title="Rename session"
          description="Change how this session appears in the session list."
          mutation={sessionMutations.renameSession(renameTargetSession.id)}
          onOpenChange={handleRenameDialogOpenChange}
        />
      )}
    </>
  );
}
