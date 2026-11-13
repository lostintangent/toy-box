import { createFileRoute, useNavigate, useRouterState, ClientOnly } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { useState, useEffect, useDeferredValue, lazy, Suspense, type ReactNode } from "react";
import { useSessions } from "@sessions/useSessions";
import { useHyperSession } from "@workspace/hooks/layout/useHyperSession";
import { useWarmSessionSnapshots } from "@sessions/useWarmSessionSnapshots";
import { useWorkspaceSync } from "@workspace/hooks/useWorkspaceSync";
import { useRestartPending, useWorkspaceSelector } from "@workspace/hooks/state";
import { useViewport } from "@/shared/hooks/useViewport";
import { CommandProvider } from "@/shared/commands/CommandProvider";
import { DialogHost } from "@/shared/dialogs/DialogHost";
import type { SidebarProps } from "@workspace/components/sidebar/Sidebar";
import { CommandPalette } from "@workspace/components/palette/CommandPalette";
import { workspaceCommands, type SessionCreationOptions } from "@workspace/commands";
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
import { WorkspaceRootsProvider, type WorkspaceRoots } from "@workspace/hooks/layout/roots";
import { deriveOpenPaneIds, MAX_WORKSPACE_PANES, type WorkspacePane } from "@workspace/model/panes";
import { parseRootPanes, serializeRootPanes } from "@workspace/components/panes/kinds";
import { createSessionPane } from "@sessions/model/panes";
import { useEditorAutoFocus } from "@sessions/useEditorAutoFocus";
import { createAppPane } from "@apps/model";
import { INBOX_PANE } from "@inbox/model";
import { readWorkspaceLayout } from "@workspace/model/config/layoutPrefs";
import { LayoutPrefsProvider, useLayoutPref } from "@workspace/hooks/layout/layoutPrefs";
import {
  filterSessionList,
  type SessionFilters,
} from "@sessions/components/sidebar/sessionFilters";
import { selectTopLevelSessions } from "@sessions/queries";
import { useHasModels } from "@providers/useModels";
import { channelQueries } from "@channels/queries";
import { automationQueries } from "@automations/queries";
import { appQueries } from "@apps/queries";
const Terminal = lazy(() =>
  import("@terminal/components/Terminal").then((m) => ({
    default: m.Terminal,
  })),
);

export const Route = createFileRoute("/")({
  // Each root pane kind declares its URL key, so the workspace URL is just the panes it opens.
  validateSearch: (search: Record<string, unknown>) => serializeRootPanes(parseRootPanes(search)),
  loader: async () => readWorkspaceLayout(await readCookieHeader()),
  component: () => (
    <LayoutPrefsProvider initialLayout={Route.useLoaderData()}>
      <WorkspacePage />
    </LayoutPrefsProvider>
  ),
});

const readCookieHeader = createIsomorphicFn()
  .client(() => document.cookie)
  .server(async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("cookie") ?? getRequestHeader("Cookie");
  });

function WorkspacePage() {
  const navigate = useNavigate();
  const { workspaceRevision } = Route.useRouteContext();
  const selectedRoots = parseRootPanes(Route.useSearch());
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

  // A full workspace admits only the panes it already shows.
  function hasRoomFor(pane: WorkspacePane) {
    return (
      visiblePanes.length < MAX_WORKSPACE_PANES || visiblePanes.some(({ id }) => id === pane.id)
    );
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
    if (!hasRoomFor(pane)) return;
    void updateRoots((roots) => [...roots, pane]);
  }

  /** Opens a root beside the others, or in their place when the workspace is full. */
  async function openRoot(pane: WorkspacePane) {
    await updateRoots((roots) => (hasRoomFor(pane) ? [...roots, pane] : [pane]));
    // The mobile pager has to be paged to it.
    if (isMobileLayout) focusWorkspaceSurfacePane("main", pane.id);
  }

  function closeRoot(pane: WorkspacePane) {
    if (!selectedRoots.some(({ id }) => id === pane.id)) return;
    void updateRoots((roots) => roots.filter(({ id }) => id !== pane.id), { replace: true });
  }

  const primarySelectedSessionId = selectedRoots.find(({ kind }) => kind === "session")?.sessionId;
  const hasWorkspaceRoot = selectedRoots.length > 0;
  const rootPanes = hasWorkspaceRoot ? selectedRoots : [INBOX_PANE];
  const resolvePaneClose = (pane: WorkspacePane) =>
    selectedRoots.some(({ id }) => id === pane.id) ? () => closeRoot(pane) : undefined;
  const visiblePanes = useSurfacePanes("main", rootPanes);
  useEditorAutoFocus("main", visiblePanes);

  const disabledProviders = useWorkspaceSelector(
    (workspace) => workspace.settings.disabledProviders,
  );

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLayoutPref("sidebarCollapsed");
  const [isTerminalOpen, setIsTerminalOpen] = useLayoutPref("terminalOpen");
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const hasModels = useHasModels();
  const restartPending = useRestartPending();
  const { data: channelList } = useQuery(channelQueries.list);
  const channels = channelList?.channels;
  const { data: automations } = useSuspenseQuery(automationQueries.list);
  const { data: appIds } = useSuspenseQuery({
    ...appQueries.list,
    select: (list) => list.apps.map((app) => app.id),
  });
  const { hyperSessionId: storedHyperSessionId, pinnedSessionIds } = useWorkspaceSelector(
    (workspace) => ({
      hyperSessionId: workspace.settings.hyperSessionId,
      pinnedSessionIds: workspace.settings.pinnedSessionIds,
    }),
  );
  useWorkspaceSync(workspaceRevision);
  const { sessions, ownership, worktreeSessionIds, createSession } = useSessions();

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
    const sessionIds = new Set(sessions.map(({ id }) => id));
    for (const automation of automations) {
      if (!disabledProviders.includes(automation.model.provider)) sessionIds.add(automation.id);
    }
    const isStale = (pane: WorkspacePane) =>
      pane.kind === "session"
        ? !sessionIds.has(pane.sessionId)
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
  }, [appIds, automations, channels, disabledProviders, navigate, selectedRoots, sessions]);

  const [filter, setFilter] = useState<SessionFilters>({
    query: "",
    hiddenProviders: [],
    showExternalSessions: true,
  });
  const toggleSidebar = () => setIsSidebarCollapsed(!isSidebarCollapsed);

  function toggleTerminal() {
    setIsTerminalOpen(!isTerminalOpen);
  }

  function handleTerminalClose() {
    setIsTerminalOpen(false);
  }

  const deferredFilter = useDeferredValue(filter.query);

  const listedSessions = selectTopLevelSessions({ sessions, ownership }, storedHyperSessionId);

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

  // The setting can outlive a session deleted outside Toy Box.
  const hyperSessionId = sessions.find(({ id }) => id === storedHyperSessionId)?.id;
  const hyper = useHyperSession({ hyperSessionId, createSession, openRoot });
  const hyperSession = hyper.state;
  const { getOrCreateSessionId: getOrCreateHyperSessionId, toggle: toggleHyperSession } = hyper;

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

  const commands = workspaceCommands({
    togglePalette: () => setIsPaletteOpen((open) => !open),
    sidebar: isMobileLayout ? undefined : { isOpen: !isSidebarCollapsed, toggle: toggleSidebar },
    terminal: { isOpen: isTerminalOpen, toggle: toggleTerminal },
    hyper: { isOpen: isHyperOpen, toggle: toggleHyper },
    inbox: { isOpen: isInboxOpen, open: handleOpenInbox },
    hasModels,
    restartPending,
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

  // Shared sidebar props for both mobile and desktop.
  const sidebarProps = {
    filter,
    onFilterChange: setFilter,
    sessions: filteredSessions,
    worktreeSessionIds,
    emptyMessage:
      deferredFilter || filter.hiddenProviders.length || !filter.showExternalSessions
        ? "No sessions match your filters"
        : undefined,
    onAppOpenInHyper: handleAppOpenInHyper,
  } satisfies SidebarProps;

  const mobileLayoutProps = {
    sidebar: sidebarProps,
    workspace: {
      visible: isMobileWorkspaceVisible,
      panes: visiblePanes,
      primaryPaneId: rootPanes[0].id,
      onBack: handleMobileWorkspaceBack,
      resolvePaneClose,
    },
    terminal: isMobileLayout ? terminalBody : terminalBodySkeleton,
  } satisfies WorkspaceLayoutProps["mobile"];

  const desktopLayoutProps = {
    sidebar: sidebarProps,
    workspace: { panes: visiblePanes, resolvePaneClose },
    terminal: !isMobileLayout ? terminalBody : terminalBodySkeleton,
    hyper:
      hyperSession && hyper.isOpen
        ? {
            state: hyperSession,
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
        panes={visiblePanes}
        onOpen={(pane) => void openRoot(pane)}
      >
        <RootsProvider
          selectRoot={selectRoot}
          openRoot={openRoot}
          visiblePanes={visiblePanes}
          rootIds={selectedRoots.map(({ id }) => id)}
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
          />
          <DialogHost />
        </RootsProvider>
      </WorkspaceSurfaceProvider>
    </CommandProvider>
  );
}

/**
 * Provides the chrome its roots. A root is open from the moment a navigation heads to it, so
 * only the chrome renders until the navigation commits, not the whole workspace.
 */
function RootsProvider({
  visiblePanes,
  rootIds,
  children,
  ...roots
}: Omit<WorkspaceRoots, "isOpen"> & {
  visiblePanes: WorkspacePane[];
  rootIds: string[];
  children: ReactNode;
}) {
  const targetRootIds = useRouterState({
    select: (state) => parseRootPanes(state.location.search).map(({ id }) => id),
    structuralSharing: true,
  });
  const openPaneIds = deriveOpenPaneIds({ visiblePanes, rootIds, targetRootIds });
  return (
    <WorkspaceRootsProvider value={{ ...roots, isOpen: (pane) => openPaneIds.has(pane.id) }}>
      {children}
    </WorkspaceRootsProvider>
  );
}
