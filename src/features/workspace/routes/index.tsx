import { createFileRoute, useNavigate, useRouterState, ClientOnly } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { useState, useEffect, useDeferredValue, lazy, Suspense } from "react";
import { useSessions } from "@sessions/useSessions";
import { useHyperSession } from "@workspace/hooks/layout/useHyperSession";
import { useWarmSessionSnapshots } from "@sessions/useWarmSessionSnapshots";
import { useWorkspaceSync } from "@workspace/hooks/useWorkspaceSync";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useViewport } from "@/shared/hooks/useViewport";
import { CommandProvider } from "@/shared/commands/CommandProvider";
import type { SidebarProps } from "@workspace/components/sidebar/Sidebar";
import { WorkspaceDialogs } from "@workspace/components/WorkspaceDialogs";
import { CommandPalette } from "@workspace/components/palette/CommandPalette";
import { createWorkspaceCommands, type SessionCreationOptions } from "@workspace/commands";
import {
  WorkspaceLayout,
  type WorkspaceLayoutProps,
} from "@workspace/components/layout/WorkspaceLayout";
import {
  focusWorkspaceSurfacePane,
  useSurfacePanes,
  workspaceSurfaces,
  WorkspaceSurfaceProvider,
} from "@workspace/hooks/layout/surface";
import { MAX_WORKSPACE_PANES, type WorkspacePane } from "@workspace/model/panes";
import { parseRootPanes, serializeRootPanes } from "@workspace/components/panes/kinds";
import { createSessionPane } from "@sessions/model/panes";
import { useEditorAutoFocus } from "@sessions/useEditorAutoFocus";
import { createAppPane } from "@apps/model";
import { INBOX_PANE } from "@inbox/model";
import {
  readWorkspaceLayout,
  serializeWorkspaceLayout,
  type SidebarPanels,
} from "@workspace/model/config/layoutPrefs";
import {
  filterSessionList,
  type SessionFilters,
} from "@sessions/components/sidebar/sessionFilters";
import { selectTopLevelSessions, sessionQueries } from "@sessions/queries";
import { providerQueries } from "@providers/queries";
import { useHasModels } from "@providers/useModels";
import { channelQueries } from "@channels/queries";
import { automationQueries } from "@automations/queries";
import { inboxQueries } from "@inbox/queries";
import { appQueries } from "@apps/queries";
import { fileQueries } from "@files/queries";
import { workerQueries } from "@workers/queries";
const Terminal = lazy(() =>
  import("@terminal/components/Terminal").then((m) => ({
    default: m.Terminal,
  })),
);

export const Route = createFileRoute("/")({
  // Each root pane kind declares its URL key, so the workspace URL is just the panes it opens.
  validateSearch: (search: Record<string, unknown>) => serializeRootPanes(parseRootPanes(search)),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(sessionQueries.state()),
      context.queryClient.ensureQueryData(sessionQueries.activity()),
      context.queryClient.ensureQueryData(channelQueries.list()),
      context.queryClient.ensureQueryData(automationQueries.list()),
      context.queryClient.ensureQueryData(inboxQueries.list()),
      context.queryClient.ensureQueryData(appQueries.list()),
      context.queryClient.ensureQueryData(providerQueries.catalog()),
      context.queryClient.ensureQueryData(workerQueries.active()),
      context.queryClient.ensureQueryData(fileQueries.editors()),
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

function WorkspacePage() {
  const navigate = useNavigate();
  const { workspaceRevision } = Route.useRouteContext();
  const selectedRoots = parseRootPanes(Route.useSearch());
  const targetSelectedSessionIds = useRouterState({
    select: (state) => selectSessionIds(parseRootPanes(state.location.search)),
    structuralSharing: true,
  });
  const selectedSessionIds = selectSessionIds(selectedRoots);
  const initialLayout = Route.useLoaderData();
  const { isMobile: isMobileLayout, hydrated } = useViewport();

  function updateRoots(
    update: (roots: WorkspacePane[]) => WorkspacePane[],
    options?: { replace?: boolean },
  ) {
    return navigate({
      to: "/",
      search: (prev) => serializeRootPanes(update(parseRootPanes(prev))),
      replace: options?.replace,
    });
  }

  // Selecting a root replaces the workspace; a modifier toggles it beside the other roots.
  function selectRoot(pane: WorkspacePane, toggleInWorkspace = false) {
    if (!toggleInWorkspace || isMobileLayout) {
      void updateRoots(() => [pane]);
      return;
    }
    if (selectedRoots.some(({ id }) => id === pane.id)) {
      closeRoot(pane);
      return;
    }
    if (openPanes.length >= MAX_WORKSPACE_PANES && !openPanes.some(({ id }) => id === pane.id))
      return;
    void updateRoots((roots) => [...roots, pane]);
  }

  /** Opens a root beside the others, or in their place when the workspace is full. */
  async function openRoot(pane: WorkspacePane) {
    const isFull =
      openPanes.length >= MAX_WORKSPACE_PANES && !openPanes.some(({ id }) => id === pane.id);
    await updateRoots((roots) => (isFull ? [pane] : [...roots, pane]));
    // The mobile pager has to be paged to it.
    if (isMobileLayout) focusWorkspaceSurfacePane("main", pane.id);
  }

  function closeRoot(pane: WorkspacePane) {
    if (!selectedRoots.some(({ id }) => id === pane.id)) return;
    void updateRoots((roots) => roots.filter(({ id }) => id !== pane.id), { replace: true });
  }

  const primarySelectedSessionId = selectedSessionIds[0];
  const hasWorkspaceRoot = selectedRoots.length > 0;
  const rootPanes = hasWorkspaceRoot ? selectedRoots : [INBOX_PANE];
  const resolvePaneClose = (pane: WorkspacePane) =>
    selectedRoots.some(({ id }) => id === pane.id) ? () => closeRoot(pane) : undefined;
  const openPanes = useSurfacePanes("main", rootPanes);
  const openSessionIds = selectSessionIds(openPanes);
  useEditorAutoFocus("main", openPanes);
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
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [sidebarPanels, setSidebarPanels] = useState<SidebarPanels>(initialLayout.panels);
  const [isChannelOverviewPinned, setIsChannelOverviewPinned] = useState(
    initialLayout.channelOverviewPinned,
  );

  const hasModels = useHasModels();
  const { data: channelList } = useQuery(channelQueries.list());
  const channels = channelList?.channels;
  const { data: automations } = useSuspenseQuery(automationQueries.list());
  const { data: appIds } = useSuspenseQuery({
    ...appQueries.list(),
    select: (list) => list.apps.map((app) => app.id),
  });
  const { hyperSessionIds, pinnedSessionIds } = useWorkspaceSelector((workspace) => ({
    hyperSessionIds: workspace.hyperSessionIds,
    pinnedSessionIds: workspace.settings.pinnedSessionIds,
  }));
  useWorkspaceSync(workspaceRevision);
  const {
    sessions,
    ownership,
    isLoading: isSessionsLoading,
    worktreeSessionIds,
    createSession,
  } = useSessions({
    hiddenSessionIds: hyperSessionIds,
  });

  // Create a draft session, optionally with an initial artifact or alongside the workspace.
  function handleCreateSession(options: SessionCreationOptions = {}) {
    const pane = createSessionPane(
      createSession(options.artifact ? { artifact: options.artifact } : undefined),
    );
    if (options.addToWorkspace) void openRoot(pane);
    else selectRoot(pane);
  }

  // Close roots whose content left its catalog, such as a deleted channel or app, or an older
  // session losing its pin.
  useEffect(() => {
    const sessionIds = new Set(sessions?.map(({ id }) => id));
    for (const automation of automations) {
      if (!disabledProviders.includes(automation.model.provider)) sessionIds.add(automation.id);
    }
    const isStale = (pane: WorkspacePane) =>
      pane.kind === "session"
        ? !isSessionsLoading && !sessionIds.has(pane.sessionId)
        : pane.kind === "app"
          ? !appIds.includes(pane.appId)
          : pane.kind === "channel" &&
            channels !== undefined &&
            !channels.some(({ id }) => id === pane.channelId);
    if (!selectedRoots.some(isStale)) return;

    void navigate({
      to: "/",
      search: (prev) => serializeRootPanes(parseRootPanes(prev).filter((pane) => !isStale(pane))),
      replace: true,
    });
  }, [
    appIds,
    automations,
    channels,
    disabledProviders,
    isSessionsLoading,
    navigate,
    selectedRoots,
    sessions,
  ]);

  const [filter, setFilter] = useState<SessionFilters>({
    query: "",
    hiddenProviders: [],
    showExternalSessions: true,
  });
  const toggleSidebar = () => setIsSidebarCollapsed((collapsed) => !collapsed);

  function toggleTerminal() {
    setIsTerminalOpen((prev) => !prev);
  }

  function handleTerminalClose() {
    setIsTerminalOpen(false);
  }

  const deferredFilter = useDeferredValue(filter.query);

  const listedSessions = selectTopLevelSessions(
    { sessions: sessions ?? [], ownership: ownership ?? {} },
    hyperSessionIds,
  );

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

  const hyperSessionId = hyperSessionIds.find((id) =>
    sessions?.some((session) => session.id === id),
  );
  const hyper = useHyperSession({
    hyperSessionId,
    initialLayout: { open: initialLayout.hyperOpen, position: initialLayout.hyperPosition },
    createSession,
    openRoot,
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
    channelOverviewPinned: isChannelOverviewPinned,
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
    void updateRoots(() => [createSessionPane(getOrCreateHyperSessionId())]);
  }

  // "Open" is viewport-relative: the deck is open on desktop; on mobile the hyper
  // session is open when it's the one in view. The sidebar dot is its inverse.
  const isHyperOpen = isMobileLayout
    ? hyperSessionId !== undefined && primarySelectedSessionId === hyperSessionId
    : hyper.isOpen;

  function handleAppOpenInHyper(appId: string) {
    if (isMobileLayout) selectRoot(createAppPane(appId));
    else hyper.openApp(appId);
  }

  const isInboxOpen = !hasWorkspaceRoot && (!isMobileLayout || isSidebarCollapsed);

  function handleOpenInbox() {
    if (isMobileLayout) setIsSidebarCollapsed(true);
    if (hasWorkspaceRoot) void updateRoots(() => []);
  }

  const commands = createWorkspaceCommands({
    togglePalette: () => setIsPaletteOpen((open) => !open),
    sidebar: isMobileLayout ? undefined : { isOpen: !isSidebarCollapsed, toggle: toggleSidebar },
    terminal: { isOpen: isTerminalOpen, toggle: toggleTerminal },
    hyper: { isOpen: isHyperOpen, toggle: toggleHyper },
    inbox: { isOpen: isInboxOpen, open: handleOpenInbox },
    hasModels,
    createSession: handleCreateSession,
  });

  function handleMobileWorkspaceBack() {
    workspaceSurfaces.main.panePublications.actions.clearLinkedPanes(INBOX_PANE.id);
    setIsSidebarCollapsed(false);
    if (hasWorkspaceRoot) void updateRoots(() => []);
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
    selectRoot,
    openSessionIds: sidebarOpenSessionIds,
    worktreeSessionIds,
    emptyMessage:
      deferredFilter || filter.hiddenProviders.length || !filter.showExternalSessions
        ? "No sessions match your filters"
        : undefined,
    panels: sidebarPanels,
    onPanelExpanded: handlePanelExpanded,
    openAppIds: selectedRoots.flatMap((pane) => (pane.kind === "app" ? [pane.appId] : [])),
    onAppOpenInHyper: handleAppOpenInHyper,
    openChannelIds: selectedRoots.flatMap((pane) =>
      pane.kind === "channel" ? [pane.channelId] : [],
    ),
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
    <CommandProvider commands={commands}>
      <WorkspaceSurfaceProvider
        surface="main"
        panes={openPanes}
        onOpen={(pane) => void openRoot(pane)}
        channelOverviewPinned={isChannelOverviewPinned}
        onChannelOverviewPinnedChange={setIsChannelOverviewPinned}
      >
        <WorkspaceLayout
          hydrated={hydrated}
          isMobile={isMobileLayout}
          mobile={mobileLayoutProps}
          desktop={desktopLayoutProps}
        />
        <CommandPalette
          open={isPaletteOpen}
          onOpenChange={setIsPaletteOpen}
          sessions={listedSessions}
          openSessionIds={openSessionIds}
          navigation={{ selectRoot, openRoot }}
        />
      </WorkspaceSurfaceProvider>
      <WorkspaceDialogs selectRoot={selectRoot} openRoot={openRoot} closeRoot={closeRoot} />
    </CommandProvider>
  );
}

function selectSessionIds(panes: readonly WorkspacePane[]): string[] {
  return panes.flatMap((pane) => (pane.kind === "session" ? [pane.sessionId] : []));
}
